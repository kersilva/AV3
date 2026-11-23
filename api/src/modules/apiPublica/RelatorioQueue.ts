import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { ErroConfiguracao } from '@/shared/errors/DomainError.js';

export const NOME_FILA_RELATORIOS = 'greencode-relatorios';

function conexaoRedis(): Redis {
  const url = process.env.REDIS_URL;
  if (!url) throw new ErroConfiguracao('Defina REDIS_URL para habilitar a fila de relatórios.');
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });
}

export class RelatorioQueueClient {
  private connection?: Redis;
  private queue?: Queue;

  async publicar(solicitacaoId: string): Promise<void> {
    this.connection ??= conexaoRedis();
    this.queue ??= new Queue(NOME_FILA_RELATORIOS, { connection: this.connection });
    await this.queue.add(
      'gerar-relatorio',
      { solicitacaoId },
      {
        jobId: solicitacaoId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: 100,
        removeOnFail: false,
      },
    );
  }

  async fechar(): Promise<void> {
    await this.queue?.close();
    await this.connection?.quit();
  }
}
