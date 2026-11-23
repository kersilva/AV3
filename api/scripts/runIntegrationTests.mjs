import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = path.resolve(apiRoot, '..');
const composeFile = path.join(projectRoot, 'compose.integration.yaml');
const integrationTestsDir = path.join(apiRoot, 'tests', 'integration');
const projectName = `greencode-av3-it-${process.pid}-${randomUUID().slice(0, 8)}`;
const reportsDir = mkdtempSync(path.join(os.tmpdir(), 'greencode-av3-reports-'));
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
let started = false;

function portFor(service, containerPort) {
  const result = runCompose(['port', service, String(containerPort)], { stdio: 'pipe', encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Não foi possível descobrir a porta de ${service}.`);
  const output = result.stdout?.toString().trim() ?? '';
  const match = output.match(/:(\d+)$/);
  if (!match) throw new Error(`Porta publicada inválida para ${service}: ${output}`);
  return Number(match[1]);
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { cwd: apiRoot, stdio: 'inherit', env, ...options });
}

function runCompose(args, options = {}) {
  return run('docker', ['compose', '-p', projectName, '-f', composeFile, ...args], options);
}

let status = 1;
try {
  const up = runCompose(['up', '-d', '--wait']);
  if (up.status !== 0) throw new Error('Não foi possível iniciar os serviços efêmeros da integração.');
  started = true;
  const postgresPort = portFor('postgres', 5432);
  const redisPort = portFor('redis', 6379);
  env.DATABASE_URL = `postgresql://greencode_test:greencode_test@127.0.0.1:${postgresPort}/greencode_test?schema=public`;
  env.REDIS_URL = `redis://127.0.0.1:${redisPort}`;
  const migrate = run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma']);
  if (migrate.status !== 0) throw new Error('As migrações falharam no banco efêmero.');
  const testFiles = readdirSync(integrationTestsDir)
    .filter((name) => name.endsWith('.integration.test.ts'))
    .sort()
    .map((name) => path.join('tests', 'integration', name));
  if (testFiles.length === 0) throw new Error('Nenhum arquivo de integração foi encontrado.');
  const tests = run(process.execPath, [
    'node_modules/tsx/dist/cli.mjs', '--test-concurrency=1', '--test-reporter=spec', '--test', ...testFiles,
  ]);
  status = tests.status ?? 1;
} catch (erro) {
  process.stderr.write(`${erro instanceof Error ? erro.message : erro}\n`);
} finally {
  if (started) runCompose(['down', '--volumes', '--remove-orphans']);
  rmSync(reportsDir, { recursive: true, force: true });
}
process.exit(status);
