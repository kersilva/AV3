import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runner = path.join(apiRoot, 'scripts', 'runIntegrationTests.mjs');
const envBase = { ...process.env };

function iniciarRunner(variaveis) {
  return spawnSync(process.execPath, [runner], {
    cwd: apiRoot,
    env: { ...envBase, ...variaveis },
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

function contextoDoLog(resultado) {
  const linha = resultado.stdout.split(/\r?\n/).find((item) => item.includes('"evento":"integracao_ambiente"'));
  if (!linha) throw new Error(`Runner não informou o projeto efêmero. ${resultado.stderr}`);
  return JSON.parse(linha);
}

function conferirCleanup({ projeto, diretorioRelatorios }) {
  const containers = spawnSync('docker', ['ps', '-aq', '--filter', `label=com.docker.compose.project=${projeto}`], {
    cwd: apiRoot, env: envBase, encoding: 'utf8',
  });
  const volumes = spawnSync('docker', ['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${projeto}`], {
    cwd: apiRoot, env: envBase, encoding: 'utf8',
  });
  if (containers.status !== 0 || volumes.status !== 0) throw new Error('Docker não conseguiu verificar o cleanup.');
  if (containers.stdout.trim()) throw new Error(`Containers do projeto sobraram: ${containers.stdout}`);
  if (volumes.stdout.trim()) throw new Error(`Volumes do projeto sobraram: ${volumes.stdout}`);
  if (existsSync(diretorioRelatorios)) throw new Error(`Diretório temporário não removido: ${diretorioRelatorios}`);
}

const falha = iniciarRunner({ INTEGRATION_TEST_FORCE_FAILURE: '1' });
if (falha.status === 0) throw new Error(`Falha controlada não falhou. ${falha.stderr}`);
conferirCleanup(contextoDoLog(falha));
process.stdout.write('Cleanup após falha controlada: confirmado.\n');

const interrupcao = iniciarRunner({ INTEGRATION_TEST_SIMULATE_SIGTERM: '1' });
if (interrupcao.status !== 143) {
  throw new Error(`Runner retornou ${interrupcao.status} após simular SIGTERM. ${interrupcao.stderr}`);
}
conferirCleanup(contextoDoLog(interrupcao));
process.stdout.write('Cleanup após SIGTERM simulado: confirmado.\n');
