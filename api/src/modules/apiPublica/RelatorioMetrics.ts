import { Counter, Gauge, Histogram, Registry } from '@prometheus-io/client';

export type ResultadoTentativaRelatorio = 'success' | 'retry' | 'failure';

export class RelatorioMetrics {
  readonly registry = new Registry();
  private readonly tentativasIniciadas: Counter;
  private readonly retries: Counter;
  private readonly jobs: Counter<'result'>;
  private readonly tentativasDuracao: Histogram<'result'>;
  private readonly esperaFila: Histogram;
  private readonly duracaoSolicitacao: Histogram<'result'>;
  private readonly jobsAtivos: Gauge;

  constructor() {
    this.tentativasIniciadas = new Counter({
      name: 'greencode_report_attempts_started_total',
      help: 'Tentativas de processamento iniciadas pelo worker.',
      registers: [this.registry],
    });
    this.retries = new Counter({
      name: 'greencode_report_retries_total',
      help: 'Tentativas de retry iniciadas pelo worker.',
      registers: [this.registry],
    });
    this.jobs = new Counter({
      name: 'greencode_report_jobs_total',
      help: 'Solicitações de relatório concluídas ou falhas.',
      labelNames: ['result'],
      registers: [this.registry],
    });
    this.tentativasDuracao = new Histogram({
      name: 'greencode_report_attempt_duration_seconds',
      help: 'Duração de cada tentativa concluída.',
      labelNames: ['result'],
      buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 120, 300],
      registers: [this.registry],
    });
    this.esperaFila = new Histogram({
      name: 'greencode_report_queue_wait_seconds',
      help: 'Tempo entre a criação da solicitação e a primeira tentativa.',
      buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 300, 900],
      registers: [this.registry],
    });
    this.duracaoSolicitacao = new Histogram({
      name: 'greencode_report_request_duration_seconds',
      help: 'Tempo entre a criação e o estado final da solicitação.',
      labelNames: ['result'],
      buckets: [1, 5, 10, 30, 60, 120, 300, 900],
      registers: [this.registry],
    });
    this.jobsAtivos = new Gauge({
      name: 'greencode_report_jobs_active',
      help: 'Jobs de relatório em processamento neste worker.',
      registers: [this.registry],
    });
  }

  iniciarTentativa(numero: number): void {
    this.tentativasIniciadas.inc();
    if (numero > 1) this.retries.inc();
    this.jobsAtivos.inc();
  }

  concluirTentativa(resultado: ResultadoTentativaRelatorio, duracaoMs: number): void {
    this.tentativasDuracao.observe({ result: resultado }, Math.max(0, duracaoMs) / 1_000);
    this.jobsAtivos.dec();
  }

  observarEsperaFila(duracaoMs: number): void {
    this.esperaFila.observe(Math.max(0, duracaoMs) / 1_000);
  }

  concluirSolicitacao(resultado: 'success' | 'failure', duracaoMs: number): void {
    this.jobs.inc({ result: resultado });
    this.duracaoSolicitacao.observe({ result: resultado }, Math.max(0, duracaoMs) / 1_000);
  }
}

export const relatorioMetrics = new RelatorioMetrics();
