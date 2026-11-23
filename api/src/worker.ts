import 'dotenv/config';
import { createServer } from 'node:http';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { prisma } from '@infra/database.js';
import { NOME_FILA_RELATORIOS, RelatorioQueueClient } from '@apiPublica/RelatorioQueue.js';
import { relatorioMetrics } from '@apiPublica/RelatorioMetrics.js';
import { RelatorioApiService } from '@apiPublica/RelatorioApiService.js';
import { processarRelatorioJob } from '@apiPublica/processarRelatorioJob.js';
import { aoFalharJobRelatorio } from '@apiPublica/RelatorioWorkerEvents.js';

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error('Defina REDIS_URL para iniciar o worker de relatórios.');

const conexao = new Redis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false });
const fila = new RelatorioQueueClient();
const worker = new Worker<{ solicitacaoId: string }>(
  NOME_FILA_RELATORIOS,
  async (job) => processarRelatorioJob(job.data.solicitacaoId, job.attemptsMade + 1, Number(job.opts.attempts ?? 1), { job }),
  { connection: conexao, concurrency: 2, lockDuration: 120_000, maxStalledCount: 1 },
);

worker.on('failed', async (job, erro) => {
  if (!job) return;
  const tentativasMaximas = Number(job.opts.attempts ?? 1);
  await aoFalharJobRelatorio(job.data.solicitacaoId, job.attemptsMade, tentativasMaximas, erro);
});

const timer = setInterval(() => {
  void publicarPendentes().catch((erro: unknown) => {
    console.error(JSON.stringify({ evento: 'outbox_despacho_falhou', erro: erro instanceof Error ? erro.message : 'Erro desconhecido' }));
  });
}, 5_000);
timer.unref();
function publicarPendentes(): Promise<void> {
  return new RelatorioApiService(fila).publicarPendentes();
}
void publicarPendentes().catch((erro: unknown) => console.error(JSON.stringify({ evento: 'outbox_despacho_inicial_falhou', erro })));

const metricsPort = Number(process.env.METRICS_PORT ?? 9464);
const metricsHost = process.env.METRICS_HOST ?? '127.0.0.1';
const servidorMetrics = createServer(async (request, response) => {
  if (request.url !== '/metrics' || request.method !== 'GET') {
    response.writeHead(404).end('Not found');
    return;
  }
  try {
    response.writeHead(200, { 'Content-Type': relatorioMetrics.registry.contentType });
    response.end(await relatorioMetrics.registry.metrics());
  } catch (erro) {
    response.writeHead(500).end('Metrics unavailable');
    console.error(JSON.stringify({ evento: 'metrics_export_falhou', erro }));
  }
});
servidorMetrics.listen(metricsPort, metricsHost);

let encerrando = false;
async function encerrar(): Promise<void> {
  if (encerrando) return;
  encerrando = true;
  clearInterval(timer);
  await Promise.all([
    worker.close(),
    fila.fechar(),
    new Promise<void>((resolve) => servidorMetrics.close(() => resolve())),
  ]);
  await conexao.quit();
  await prisma.$disconnect();
}
process.once('SIGINT', () => void encerrar());
process.once('SIGTERM', () => void encerrar());

console.info(JSON.stringify({ evento: 'worker_relatorios_ativo', fila: NOME_FILA_RELATORIOS, metrics: `http://${metricsHost}:${metricsPort}/metrics` }));
