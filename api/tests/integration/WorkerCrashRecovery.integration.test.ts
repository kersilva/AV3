import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rm, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { prisma } from '../../src/infrastructure/database.js';
import { NOME_FILA_RELATORIOS } from '../../src/modules/apiPublica/RelatorioQueue.js';
import { criarParceiroFixture } from './support.js';

type MensagemWorker = { tipo: string; checkpoint?: string; id?: string; erro?: string };
type ProcessoWorker = {
  processo: ChildProcess;
  stderr: () => string;
  esperar: (predicado: (mensagem: MensagemWorker) => boolean, descricao: string, timeoutMs?: number) => Promise<MensagemWorker>;
};

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function redisUrlAtual(): string {
  const resultado = spawnSync('docker', [
    'compose', '-p', process.env.TEST_COMPOSE_PROJECT!, '-f', process.env.TEST_COMPOSE_FILE!, 'port', 'redis', '6379',
  ], { encoding: 'utf8', env: process.env });
  if (resultado.status !== 0) throw new Error('Não foi possível detectar a porta atual do Redis efêmero.');
  const porta = resultado.stdout.trim().match(/:(\d+)$/)?.[1];
  if (!porta) throw new Error(`Porta publicada do Redis inválida: ${resultado.stdout}`);
  return `redis://127.0.0.1:${porta}`;
}

function iniciarWorker(crashAt?: string): ProcessoWorker {
  const processo = spawn(process.execPath, [
    path.join(apiRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'scripts/workerCrashFixture.ts',
  ], {
    cwd: apiRoot,
    env: {
      ...process.env,
      REDIS_URL: redisUrlAtual(),
      CRASH_AT: crashAt ?? '',
      RELATORIO_LEASE_MS: '1800',
      RELATORIO_LEASE_RENEW_MS: '300',
      RELATORIO_BULL_LOCK_DURATION_MS: '800',
      RELATORIO_BULL_STALLED_INTERVAL_MS: '250',
      RELATORIO_BULL_MAX_STALLED_COUNT: '1',
    },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let erros = '';
  processo.stderr?.on('data', (parte: Buffer) => { erros = `${erros}${parte.toString()}`.slice(-8_000); });
  const mensagens: MensagemWorker[] = [];
  const aguardando: Array<{
    predicado: (mensagem: MensagemWorker) => boolean;
    resolve: (mensagem: MensagemWorker) => void;
    reject: (erro: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];
  processo.on('message', (mensagem: unknown) => {
    const recebida = mensagem as MensagemWorker;
    if (recebida.tipo === 'erro' || recebida.tipo === 'falhou') {
      const mensagemErro = recebida.erro ?? recebida.tipo;
      for (const item of aguardando.splice(0)) {
        clearTimeout(item.timer);
        item.reject(new Error(`Worker reportou ${recebida.tipo}: ${mensagemErro}. ${erros}`));
      }
      mensagens.push(recebida);
      return;
    }
    const indice = aguardando.findIndex((item) => item.predicado(recebida));
    if (indice >= 0) {
      const item = aguardando.splice(indice, 1)[0]!;
      clearTimeout(item.timer);
      item.resolve(recebida);
    } else mensagens.push(recebida);
  });
  processo.on('exit', (codigo, sinal) => {
    for (const item of aguardando.splice(0)) {
      clearTimeout(item.timer);
      item.reject(new Error(`Worker encerrou (${codigo ?? sinal}). ${erros}`));
    }
  });

  return {
    processo,
    stderr: () => erros,
    esperar: (predicado, descricao, timeoutMs = 45_000) => {
      const indiceErro = mensagens.findIndex((mensagem) => mensagem.tipo === 'erro' || mensagem.tipo === 'falhou');
      if (indiceErro >= 0) {
        const mensagemErro = mensagens.splice(indiceErro, 1)[0]!;
        return Promise.reject(new Error(`Worker reportou ${mensagemErro.tipo}: ${mensagemErro.erro ?? mensagemErro.tipo}. ${erros}`));
      }
      const indice = mensagens.findIndex(predicado);
      if (indice >= 0) return Promise.resolve(mensagens.splice(indice, 1)[0]!);
      return new Promise((resolve, reject) => {
        const item = {
          predicado,
          resolve,
          reject,
          timer: setTimeout(() => {
            const posicao = aguardando.indexOf(item);
            if (posicao >= 0) aguardando.splice(posicao, 1);
            reject(new Error(`Timeout aguardando ${descricao}. ${erros}`));
          }, timeoutMs),
        };
        aguardando.push(item);
      });
    },
  };
}

async function pararWorker(processo: ChildProcess): Promise<void> {
  if (processo.exitCode !== null || processo.signalCode !== null) return;
  const encerrado = new Promise<void>((resolve) => processo.once('exit', () => resolve()));
  processo.kill('SIGTERM');
  await Promise.race([
    encerrado,
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('Worker filho não encerrou.')), 8_000)),
  ]);
}

async function matarWorker(processo: ChildProcess): Promise<void> {
  if (processo.exitCode !== null || processo.signalCode !== null) return;
  const encerrado = new Promise<void>((resolve) => processo.once('exit', () => resolve()));
  processo.kill('SIGKILL');
  await encerrado;
}

test('recupera relatórios após crash abrupto em cada checkpoint durável do worker', { timeout: 180_000 }, async (context) => {
  const fixture = await criarParceiroFixture(context, 'Crash recovery worker');
  const redisUrl = redisUrlAtual();
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  redis.on('error', () => undefined);
  const fila = new Queue(NOME_FILA_RELATORIOS, { connection: redis });
  const diretorioSaida = process.env.REPORTS_DIR ?? path.join(os.tmpdir(), 'greencode-reports');
  const casos = ['duranteAnalise', 'depoisDaAnalise', 'depoisDoArquivo'];
  const processos: ChildProcess[] = [];
  const ids: string[] = [];
  context.after(async () => {
    for (const processo of processos) await pararWorker(processo).catch(() => processo.kill('SIGKILL'));
    for (const id of ids) {
      await fila.getJob(id).then((job) => job?.remove()).catch(() => undefined);
      await prisma.solicitacaoRelatorio.deleteMany({ where: { id } });
      await rm(path.join(diretorioSaida, `${id}.json`), { force: true });
      const arquivos = await readdir(diretorioSaida).catch(() => []);
      await Promise.all(arquivos.filter((nome) => nome.startsWith(`${id}.json.`) && nome.endsWith('.tmp'))
        .map((nome) => rm(path.join(diretorioSaida, nome), { force: true })));
    }
    await fila.close();
    redis.disconnect();
  });

  for (const checkpoint of casos) {
    const id = randomUUID();
    ids.push(id);
    const criadoEm = new Date(Date.now() - 10_000);
    await prisma.solicitacaoRelatorio.create({ data: {
      id,
      parceiroId: fixture.parceiroId,
      tipoRelatorio: 'COMPLETO',
      parametros: { organizacaoId: fixture.organizacaoId, dataReferencia: criadoEm.toISOString() },
      outbox: { create: { id: randomUUID(), status: 'PUBLICADO', publicadoEm: criadoEm } },
    } });
    await fila.add('gerar-relatorio', { solicitacaoId: id }, {
      jobId: id,
      attempts: 3,
      backoff: { type: 'fixed', delay: 100 },
      removeOnComplete: false,
      removeOnFail: false,
    });

    const primeiroWorker = iniciarWorker(checkpoint);
    processos.push(primeiroWorker.processo);
    await primeiroWorker.esperar((mensagem) => mensagem.tipo === 'pronto', `worker inicial ficar pronto (${checkpoint})`);
    await primeiroWorker.esperar((mensagem) => mensagem.tipo === 'checkpoint' && mensagem.checkpoint === checkpoint, `checkpoint ${checkpoint}`);
    await matarWorker(primeiroWorker.processo);

    const workerRecuperacao = iniciarWorker();
    processos.push(workerRecuperacao.processo);
    await workerRecuperacao.esperar((mensagem) => mensagem.tipo === 'pronto', `worker de recuperação ficar pronto (${checkpoint})`);
    let concluido: MensagemWorker;
    try {
      concluido = await workerRecuperacao.esperar(
        (mensagem) => mensagem.tipo === 'concluido' && mensagem.id === id,
        `conclusão do relatório após ${checkpoint}`,
      );
    } catch (erro) {
      const job = await fila.getJob(id);
      const estadoJob = job ? await job.getState() : 'ausente';
      const estadoSolicitacao = await prisma.solicitacaoRelatorio.findUnique({
        where: { id },
        select: { status: true, tentativas: true, leaseExpiresAt: true, erroMensagem: true },
      });
      throw new Error(
        `${erro instanceof Error ? erro.message : erro} ` +
        `Estado após ${checkpoint}: BullMQ=${estadoJob}, attemptsMade=${job?.attemptsMade ?? 'n/a'}, ` +
        `solicitação=${JSON.stringify(estadoSolicitacao)}.`,
      );
    }
    assert.equal(concluido.id, id, `recuperação após ${checkpoint}`);
    await pararWorker(workerRecuperacao.processo);

    const solicitacao = await prisma.solicitacaoRelatorio.findUniqueOrThrow({ where: { id } });
    assert.equal(solicitacao.status, 'CONCLUIDO', `estado final após ${checkpoint}`);
    const resultado = solicitacao.resultado as { execucaoId?: string } | null;
    assert.ok(resultado?.execucaoId);
    assert.equal(await prisma.execucaoAnalise.count({ where: { solicitacaoRelatorioId: id } }), 1);
    assert.ok(solicitacao.tentativas >= 2, `nova reivindicação ocorreu após ${checkpoint}`);

    const arquivo = path.join(diretorioSaida, `${id}.json`);
    const json = JSON.parse(await readFile(arquivo, 'utf8')) as { execucaoId?: string };
    assert.equal(json.execucaoId, resultado.execucaoId);
    const temporarios = (await readdir(diretorioSaida)).filter((nome) => nome.startsWith(`${id}.json.`) && nome.endsWith('.tmp'));
    assert.deepEqual(temporarios, [], `sem arquivos temporários abandonados após ${checkpoint}`);
    const job = await fila.getJob(id);
    assert.ok(job);
    assert.equal(await job.getState(), 'completed');
    assert.ok(job.attemptsMade < 3, 'recuperação não esgota os retries do job');
  }
});
