import 'dotenv/config';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { prisma } from '../src/infrastructure/database.js';
import { NOME_FILA_RELATORIOS } from '../src/modules/apiPublica/RelatorioQueue.js';
import { processarRelatorioJob } from '../src/modules/apiPublica/processarRelatorioJob.js';

if (process.env.RUN_INTEGRATION_TESTS !== '1') throw new Error('Fixture disponível somente na suíte de integração.');
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error('Defina REDIS_URL.');
const pauseAt = process.env.CRASH_AT;
const redis = new Redis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false });
redis.on('error', () => undefined);
const worker = new Worker<{ solicitacaoId: string }>(
  NOME_FILA_RELATORIOS,
  async (job) => processarRelatorioJob(
    job.data.solicitacaoId,
    job.attemptsMade + 1,
    Number(job.opts.attempts ?? 1),
    {
      job,
      duranteAnalise: async () => pausar('duranteAnalise'),
      depoisDaAnalise: async () => pausar('depoisDaAnalise'),
      depoisDoArquivoPersistido: async () => pausar('depoisDoArquivo'),
    },
  ),
  {
    connection: redis,
    concurrency: 1,
    lockDuration: Number(process.env.RELATORIO_BULL_LOCK_DURATION_MS ?? 1_000),
    stalledInterval: Number(process.env.RELATORIO_BULL_STALLED_INTERVAL_MS ?? 500),
    maxStalledCount: Number(process.env.RELATORIO_BULL_MAX_STALLED_COUNT ?? 1),
  },
);

function enviar(mensagem: Record<string, unknown>): void {
  if (process.send) process.send(mensagem);
}

async function pausar(checkpoint: string): Promise<void> {
  if (pauseAt !== checkpoint) return;
  enviar({ tipo: 'checkpoint', checkpoint });
  await new Promise<void>(() => undefined);
}

worker.on('completed', (job, resultado) => enviar({ tipo: 'concluido', id: job.data.solicitacaoId, resultado }));
worker.on('failed', (job, erro) => enviar({ tipo: 'falhou', id: job?.data.solicitacaoId, erro: erro.message }));
worker.on('error', (erro) => enviar({ tipo: 'erro', erro: erro.message }));

await worker.waitUntilReady();
enviar({ tipo: 'pronto' });

let encerrando = false;
async function encerrar(): Promise<void> {
  if (encerrando) return;
  encerrando = true;
  await worker.close().catch(() => undefined);
  redis.disconnect();
  await prisma.$disconnect();
}
process.once('SIGINT', () => void encerrar());
process.once('SIGTERM', () => void encerrar());
