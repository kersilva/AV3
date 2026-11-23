import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { ErroConfiguracao } from '@/shared/errors/DomainError.js';

export const NOME_FILA_RELATORIOS = 'greencode-relatorios';

export type EstadoJobRelatorio =
  | 'active'
  | 'completed'
  | 'delayed'
  | 'failed'
  | 'paused'
  | 'waiting'
  | 'waiting-children'
  | 'prioritized';

export type ConfiguracaoRelatorioQueue = {
  url?: string;
  timeoutPublicacaoMs?: number;
};

function conexaoRedis(urlConfigurada?: string): Redis {
  const url = urlConfigurada ?? process.env.REDIS_URL;
  if (!url) throw new ErroConfiguracao('Defina REDIS_URL para habilitar a fila de relatórios.');
  return new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (tentativa) => Math.min(tentativa * 100, 1_000),
  });
}

export class RelatorioQueueClient {
  private connection?: Redis;
  private queue?: Queue;
  private readonly timeoutPublicacaoMs: number;

  constructor(private readonly configuracao: ConfiguracaoRelatorioQueue = {}) {
    const timeoutConfigurado = configuracao.timeoutPublicacaoMs
      ?? Number(process.env.REDIS_PUBLISH_TIMEOUT_MS ?? 2_000);
    this.timeoutPublicacaoMs = Number.isFinite(timeoutConfigurado) && timeoutConfigurado > 0
      ? timeoutConfigurado
      : 2_000;
  }

  private obterFila(): Queue {
    this.connection ??= conexaoRedis(this.configuracao.url);
    this.queue ??= new Queue(NOME_FILA_RELATORIOS, { connection: this.connection });
    return this.queue;
  }

  private async comTimeout<T>(operacao: Promise<T>, mensagem: string): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operacao,
        new Promise<T>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error(mensagem)), this.timeoutPublicacaoMs);
          timeout.unref();
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async publicar(solicitacaoId: string): Promise<void> {
    await this.comTimeout(this.obterFila().add(
      'gerar-relatorio',
      { solicitacaoId },
      {
        jobId: solicitacaoId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: 100,
        removeOnFail: false,
      },
    ), `Redis não confirmou a publicação de ${solicitacaoId} no prazo.`);
  }

  async consultarJob(solicitacaoId: string): Promise<{ state: EstadoJobRelatorio; job: Awaited<ReturnType<Queue['getJob']>> } | null> {
    const fila = this.obterFila();
    const job = await this.comTimeout(
      fila.getJob(solicitacaoId),
      `Redis não respondeu à consulta do job ${solicitacaoId} no prazo.`,
    );
    if (!job) return null;
    const state = await this.comTimeout(
      job.getState(),
      `Redis não respondeu ao estado do job ${solicitacaoId} no prazo.`,
    );
    return { job, state: state as EstadoJobRelatorio };
  }

  async removerJobTerminal(solicitacaoId: string): Promise<void> {
    const encontrado = await this.consultarJob(solicitacaoId);
    if (!encontrado || !['completed', 'failed'].includes(encontrado.state)) return;
    await this.comTimeout(
      encontrado.job!.remove(),
      `Redis não removeu o job terminal ${solicitacaoId} no prazo.`,
    );
  }

  async fechar(): Promise<void> {
    try {
      if (this.queue) {
        await this.comTimeout(this.queue.close(), 'Tempo excedido ao fechar a fila de relatórios.');
      }
    } finally {
      this.connection?.disconnect();
    }
  }

  desconectar(): void {
    this.connection?.disconnect();
  }
}
