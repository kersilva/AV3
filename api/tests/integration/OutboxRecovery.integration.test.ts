import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { prisma } from '../../src/infrastructure/database.js';
import { RelatorioApiService } from '../../src/modules/apiPublica/RelatorioApiService.js';
import { RelatorioQueueClient } from '../../src/modules/apiPublica/RelatorioQueue.js';
import { processarRelatorioJob } from '../../src/modules/apiPublica/processarRelatorioJob.js';
import { relatorioMetrics } from '../../src/modules/apiPublica/RelatorioMetrics.js';

const databaseUrl = process.env.DATABASE_URL ?? '';
const testEnabled = process.env.RUN_INTEGRATION_TESTS === '1';
if (!testEnabled || !/\/greencode_test(?:\?|$)/.test(databaseUrl)) {
  throw new Error('Teste de integração exige RUN_INTEGRATION_TESTS=1 e banco greencode_test isolado.');
}

const compose = (args: string[], capture = false) => {
  const result = spawnSync('docker', [
    'compose', '-p', process.env.TEST_COMPOSE_PROJECT!, '-f', process.env.TEST_COMPOSE_FILE!, ...args,
  ], { stdio: capture ? 'pipe' : 'inherit', encoding: capture ? 'utf8' : undefined, env: process.env });
  if (result.status !== 0) throw new Error(`docker compose ${args.join(' ')} falhou.`);
  return capture ? String(result.stdout).trim() : '';
};

const publishedRedisUrl = () => {
  const port = compose(['port', 'redis', '6379'], true).match(/:(\d+)$/)?.[1];
  if (!port) throw new Error('Não foi possível detectar a porta publicada do Redis.');
  return `redis://127.0.0.1:${port}`;
};

test('recupera outbox após Redis e worker reiniciarem', { timeout: 90_000 }, async (context) => {
  let redisUrl = process.env.REDIS_URL!;
  let filaRedis = new Redis(redisUrl, { maxRetriesPerRequest: null, retryStrategy: () => null });
  filaRedis.on('error', () => undefined);
  let fila = new Queue('greencode-relatorios', { connection: filaRedis });
  let queueClient = new RelatorioQueueClient({ url: redisUrl, timeoutPublicacaoMs: 300 });
  const orgId = randomUUID();
  const parceiroId = randomUUID();
  const cnpj = '11222333000181';
  let worker: Worker | undefined;
  let workerRedis: Redis | undefined;
  const controleSolicitacao = { id: undefined as string | undefined };

  context.after(async () => {
    await worker?.close().catch(() => undefined);
    workerRedis?.disconnect();
    await fila.close().catch(() => undefined);
    filaRedis.disconnect();
    queueClient.desconectar();
    if (controleSolicitacao.id) {
      await prisma.solicitacaoRelatorio.deleteMany({ where: { id: controleSolicitacao.id } });
    }
    await prisma.parceiroApi.deleteMany({ where: { id: parceiroId } });
    await prisma.organizacao.deleteMany({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  await prisma.organizacao.create({ data: {
    id: orgId, razaoSocial: 'Org integração outbox', cnpj,
    inscricaoEstadual: 'ISENTO', enderecoCompleto: 'Teste', telefone: '11999999999', email: 'it@example.test',
  } });
  await prisma.parceiroApi.create({ data: {
    id: parceiroId, nome: 'Parceiro integração', emailContato: 'partner@example.test', organizacaoId: orgId,
  } });

  workerRedis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  workerRedis.on('error', () => undefined);
  worker = new Worker('greencode-relatorios', async () => undefined, { connection: workerRedis });
  await worker.waitUntilReady();
  await worker.close();
  workerRedis.disconnect();
  workerRedis = undefined;
  worker = undefined;
  await fila.close();
  filaRedis.disconnect();

  compose(['stop', 'redis']);
  const publisherOffline = {
    publicar: async () => { throw new Error('Redis indisponível'); },
    consultarJob: (id: string) => queueClient.consultarJob(id),
    removerJobTerminal: (id: string) => queueClient.removerJobTerminal(id),
  };
  const serviceOffline = new RelatorioApiService(publisherOffline);
  const solicitationPromise = serviceOffline.solicitar(
    { parceiroId, nome: 'Parceiro integração', organizacaoId: orgId, chaveId: randomUUID(), escopos: [] },
    {}, 'outbox-redis-offline',
  );
  const aceito = await Promise.race([
    solicitationPromise,
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('solicitação bloqueou com Redis fora')), 5_000)),
  ]);
  controleSolicitacao.id = aceito.id;
  assert.equal(aceito.status, 'PENDENTE');
  let outbox = await prisma.outboxRelatorio.findUniqueOrThrow({ where: { solicitacaoId: aceito.id } });
  assert.equal(outbox.status, 'PENDENTE');

  compose(['up', '-d', '--wait', 'redis']);
  redisUrl = publishedRedisUrl();
  queueClient = new RelatorioQueueClient({ url: redisUrl, timeoutPublicacaoMs: 300 });
  filaRedis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  filaRedis.on('error', () => undefined);
  fila = new Queue('greencode-relatorios', { connection: filaRedis });
  await fila.waitUntilReady();
  const service = new RelatorioApiService(queueClient);
  let falharAposEnfileirar = true;
  const publicadorInstavel = {
    publicar: async (id: string) => {
      await queueClient.publicar(id);
      if (falharAposEnfileirar) {
        falharAposEnfileirar = false;
        throw new Error('simula queda após Redis aceitar job');
      }
    },
    consultarJob: (id: string) => queueClient.consultarJob(id),
    removerJobTerminal: (id: string) => queueClient.removerJobTerminal(id),
  };
  await assert.rejects(() => new RelatorioApiService(publicadorInstavel).publicarPendentes());
  outbox = await prisma.outboxRelatorio.findUniqueOrThrow({ where: { solicitacaoId: aceito.id } });
  assert.equal(outbox.status, 'PENDENTE');
  assert.ok(await fila.getJob(aceito.id), 'job permanece disponível no Redis apesar da falha no commit da outbox');

  await service.publicarPendentes();
  outbox = await prisma.outboxRelatorio.findUniqueOrThrow({ where: { solicitacaoId: aceito.id } });
  assert.equal(outbox.status, 'PUBLICADO');
  assert.equal(await fila.getJob(aceito.id).then(Boolean), true, 'jobId estável evita duplicação no retry de publicação');

  await fila.close();
  filaRedis.disconnect();
  await queueClient.fechar();
  compose(['stop', 'redis']);
  compose(['up', '-d', '--wait', 'redis']);
  redisUrl = publishedRedisUrl();
  queueClient = new RelatorioQueueClient({ url: redisUrl, timeoutPublicacaoMs: 300 });
  filaRedis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  filaRedis.on('error', () => undefined);
  fila = new Queue('greencode-relatorios', { connection: filaRedis });
  await fila.waitUntilReady();
  const jobPersistido = await fila.getJob(aceito.id);
  assert.ok(jobPersistido, 'AOF preserva o job depois do reinício do Redis');

  let execucoes = 0;
  let provocarFalhaTransitoria = true;
  workerRedis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  workerRedis.on('error', () => undefined);
  worker = new Worker('greencode-relatorios', async (job) => {
    execucoes += 1;
    return processarRelatorioJob(
      job.data.solicitacaoId,
      job.attemptsMade + 1,
      Number(job.opts.attempts ?? 1),
      {
        job,
        antesDeExecutarAnalise: async () => {
          if (!provocarFalhaTransitoria) return;
          provocarFalhaTransitoria = false;
          throw new Error('falha transitória simulada para medir retry');
        },
      },
    );
  }, { connection: workerRedis, concurrency: 1 });
  await worker.waitUntilReady();

  const limite = Date.now() + 30_000;
  let solicitacao = await prisma.solicitacaoRelatorio.findUniqueOrThrow({ where: { id: aceito.id } });
  while (solicitacao.status !== 'CONCLUIDO' && Date.now() < limite) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    solicitacao = await prisma.solicitacaoRelatorio.findUniqueOrThrow({ where: { id: aceito.id } });
  }
  assert.equal(solicitacao.status, 'CONCLUIDO');
  assert.equal(solicitacao.tentativas, 2);
  assert.ok(solicitacao.duracaoProcessamentoMs > 0);
  assert.equal(execucoes, 2, 'o worker executa a tentativa original e o retry');
  const resultadoPersistido = solicitacao.resultado as { execucaoId?: string } | null;
  assert.ok(resultadoPersistido?.execucaoId);
  assert.equal(await prisma.execucaoAnalise.count({ where: { id: resultadoPersistido.execucaoId } }), 1);
  const limiteConclusaoJob = Date.now() + 5_000;
  let estadoJob = await fila.getJob(aceito.id).then((job) => job?.getState());
  while (estadoJob !== 'completed' && Date.now() < limiteConclusaoJob) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    estadoJob = await fila.getJob(aceito.id).then((job) => job?.getState());
  }
  assert.equal(estadoJob, 'completed');
  const metricas = await relatorioMetrics.registry.metrics();
  assert.match(metricas, /greencode_report_retries_total\s+1/);
  assert.match(metricas, /greencode_report_attempt_duration_seconds_count\{result="retry"\}\s+1/);
  assert.match(metricas, /greencode_report_attempt_duration_seconds_count\{result="success"\}\s+1/);
  assert.match(metricas, /greencode_report_jobs_total\{result="success"\}\s+1/);
});
