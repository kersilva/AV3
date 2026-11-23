import process from 'node:process';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = path.resolve(apiRoot, '..');
const composeFile = path.join(projectRoot, 'compose.integration.yaml');
const integrationTestsDir = path.join(apiRoot, 'tests', 'integration');
const projectName = `greencode-av3-it-${process.pid}-${randomUUID().slice(0, 8)}`;
const reportsDir = await mkdtemp(path.join(os.tmpdir(), 'greencode-av3-reports-'));
const env = {
  ...process.env,
  JWT_SECRET: 'integration-test-secret-with-at-least-32-bytes',
  RUN_INTEGRATION_TESTS: '1',
  TEST_COMPOSE_PROJECT: projectName,
  TEST_COMPOSE_FILE: composeFile,
  REPORTS_DIR: reportsDir,
  RELATORIO_OUTBOX_STALE_PUBLISH_MS: '0',
  RELATORIO_PROCESSAMENTO_STALE_MS: '0',
};

let processoAtivo;
let sinalInterrupcao;
const sinais = { SIGINT: 130, SIGTERM: 143 };
function solicitarInterrupcao(sinal) {
  if (sinalInterrupcao) return;
  sinalInterrupcao = sinal;
  processoAtivo?.kill('SIGTERM');
}
for (const sinal of Object.keys(sinais)) {
  process.once(sinal, () => {
    solicitarInterrupcao(sinal);
  });
}

function run(command, args, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const filho = spawn(command, args, {
      cwd: apiRoot,
      env,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    processoAtivo = filho;
    let stdout = '';
    let stderr = '';
    if (capture) {
      filho.stdout.on('data', (parte) => { stdout += parte.toString(); });
      filho.stderr.on('data', (parte) => { stderr += parte.toString(); });
    }
    filho.once('error', reject);
    filho.once('close', (codigo, sinal) => {
      if (processoAtivo === filho) processoAtivo = undefined;
      resolve({ status: codigo ?? (sinal ? 128 : 1), stdout, stderr, signal: sinal });
    });
  });
}

function runCompose(args, options) {
  return run('docker', ['compose', '-p', projectName, '-f', composeFile, ...args], options);
}

async function portFor(servico, portaContainer) {
  const resultado = await runCompose(['port', servico, String(portaContainer)], { capture: true });
  if (resultado.status !== 0) throw new Error(`Não foi possível descobrir a porta de ${servico}. ${resultado.stderr}`);
  const porta = resultado.stdout.trim().match(/:(\d+)$/)?.[1];
  if (!porta) throw new Error(`Porta publicada inválida para ${servico}: ${resultado.stdout}`);
  return Number(porta);
}

let status = 1;
let projetoCriado = false;
try {
  process.stdout.write(`${JSON.stringify({ evento: 'integracao_ambiente', projeto: projectName, diretorioRelatorios: reportsDir })}\n`);
  projetoCriado = true;
  const subida = await runCompose(['up', '-d', '--wait']);
  if (env.INTEGRATION_TEST_SIMULATE_SIGTERM === '1') solicitarInterrupcao('SIGTERM');
  if (sinalInterrupcao) throw new Error(`Execução interrompida por ${sinalInterrupcao}.`);
  if (subida.status !== 0) throw new Error('Não foi possível iniciar os serviços efêmeros da integração.');

  const postgresPort = await portFor('postgres', 5432);
  const redisPort = await portFor('redis', 6379);
  env.DATABASE_URL = `postgresql://greencode_test:greencode_test@127.0.0.1:${postgresPort}/greencode_test?schema=public`;
  env.REDIS_URL = `redis://127.0.0.1:${redisPort}`;
  if (sinalInterrupcao) throw new Error(`Execução interrompida por ${sinalInterrupcao}.`);

  if (env.INTEGRATION_TEST_FORCE_FAILURE === '1') {
    throw new Error('Falha controlada após criar o ambiente efêmero.');
  }

  const migrate = await run(process.execPath, [
    'node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma',
  ]);
  if (sinalInterrupcao) throw new Error(`Execução interrompida por ${sinalInterrupcao}.`);
  if (migrate.status !== 0) throw new Error('As migrações falharam no banco efêmero.');

  const testFiles = readdirSync(integrationTestsDir)
    .filter((nome) => nome.endsWith('.integration.test.ts'))
    .sort()
    .map((nome) => path.join('tests', 'integration', nome));
  if (testFiles.length === 0) throw new Error('Nenhum arquivo de integração foi encontrado.');
  const testes = await run(process.execPath, [
    'node_modules/tsx/dist/cli.mjs', '--test-concurrency=1', '--test-reporter=spec', '--test', ...testFiles,
  ]);
  if (sinalInterrupcao) throw new Error(`Execução interrompida por ${sinalInterrupcao}.`);
  status = testes.status;
} catch (erro) {
  process.stderr.write(`${erro instanceof Error ? erro.message : erro}\n`);
} finally {
  if (projetoCriado) {
    const limpeza = await runCompose(['down', '--volumes', '--remove-orphans']);
    if (limpeza.status !== 0) {
      process.stderr.write('Falha ao remover o ambiente Compose efêmero.\n');
      status = status === 0 ? 1 : status;
    }
  }
  await rm(reportsDir, { recursive: true, force: true });
}

process.exitCode = sinalInterrupcao ? sinais[sinalInterrupcao] : status;
