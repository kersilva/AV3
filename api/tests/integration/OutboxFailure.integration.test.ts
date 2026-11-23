import assert from 'node:assert/strict';
import test from 'node:test';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { prisma } from '../../src/infrastructure/database.js';
import { aoFalharJobRelatorio } from '../../src/modules/apiPublica/RelatorioWorkerEvents.js';
import { RelatorioApiService } from '../../src/modules/apiPublica/RelatorioApiService.js';
import { RelatorioQueueClient } from '../../src/modules/apiPublica/RelatorioQueue.js';
import { processarRelatorioJob } from '../../src/modules/apiPublica/processarRelatorioJob.js';
import { criarParceiroFixture } from './support.js';

test('marca FALHOU após esgotar as tentativas e mantém erro público genérico', { timeout: 30_000 }, async (context) => {
  const fixture = await criarParceiroFixture(context, 'Parceiro falha permanente');
  const redisUrl = process.env.REDIS_URL!;
  const filaRedis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  filaRedis.on('error', () => undefined);
  const fila = new Queue('greencode-relatorios', { connection: filaRedis });
  const queueClient = new RelatorioQueueClient({ url: redisUrl, timeoutPublicacaoMs: 1_000 });
  const idsCriados: string[] = [];
  const workerRuntime: { redis?: Redis; worker?: Worker } = {};

  context.after(async () => {
    await workerRuntime.worker?.close().catch(() => undefined);
    workerRuntime.redis?.disconnect();
    for (const id of idsCriados) await fila.getJob(id).then((job) => job?.remove()).catch(() => undefined);
    await fila.close().catch(() => undefined);
    filaRedis.disconnect();
    queueClient.desconectar();
  });

  const publicador = {
    publicar: async (solicitacaoId: string) => {
      idsCriados.push(solicitacaoId);
      await fila.add('gerar-relatorio', { solicitacaoId }, {
        jobId: solicitacaoId,
        attempts: 3,
        backoff: { type: 'fixed', delay: 20 },
        removeOnComplete: 100,
        removeOnFail: false,
      });
    },
    consultarJob: (id: string) => queueClient.consultarJob(id),
    removerJobTerminal: (id: string) => queueClient.removerJobTerminal(id),
  };
  const solicitacoes = new RelatorioApiService(publicador);
  const aceita = await solicitacoes.solicitar(fixture.contexto, {}, 'falha-permanente-onda-1');

  workerRuntime.redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  workerRuntime.redis.on('error', () => undefined);
  workerRuntime.worker = new Worker('greencode-relatorios', async (job) => processarRelatorioJob(
    job.data.solicitacaoId,
    job.attemptsMade + 1,
    Number(job.opts.attempts ?? 1),
    { antesDeExecutarAnalise: async () => { throw new Error('detalhe interno que não deve ser exposto'); } },
  ), { connection: workerRuntime.redis, concurrency: 1 });
  workerRuntime.worker.on('failed', async (job, erro) => {
    if (!job) return;
    await aoFalharJobRelatorio(job.data.solicitacaoId, job.attemptsMade, Number(job.opts.attempts ?? 1), erro);
  });
  await workerRuntime.worker.waitUntilReady();

  const limite = Date.now() + 15_000;
  let solicitacao = await prisma.solicitacaoRelatorio.findUniqueOrThrow({ where: { id: aceita.id } });
  while (solicitacao.status !== 'FALHOU' && Date.now() < limite) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    solicitacao = await prisma.solicitacaoRelatorio.findUniqueOrThrow({ where: { id: aceita.id } });
  }

  assert.equal(solicitacao.status, 'FALHOU');
  assert.equal(solicitacao.tentativas, 3);
  assert.equal(solicitacao.erroMensagem, 'Não foi possível gerar o relatório após as tentativas configuradas.');
  assert.doesNotMatch(solicitacao.erroMensagem, /detalhe interno/);
  const job = await fila.getJob(aceita.id);
  assert.ok(job);
  assert.equal(await job.getState(), 'failed');
  assert.equal(job.attemptsMade, 3);
});
