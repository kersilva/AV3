import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { prisma } from '@infra/database.js';
import { AnaliseService } from '@analise/AnaliseService.js';
import { RelatorioApiService } from '@apiPublica/RelatorioApiService.js';
import { NOME_FILA_RELATORIOS, RelatorioQueueClient } from '@apiPublica/RelatorioQueue.js';

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error('Defina REDIS_URL para iniciar o worker de relatórios.');

const conexao = new Redis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false });
const fila = new RelatorioQueueClient();
const solicitacoes = new RelatorioApiService(fila);
const analises = new AnaliseService();
const diretorioRelatorios = process.env.REPORTS_DIR ?? path.resolve(process.cwd(), 'storage', 'relatorios');

const worker = new Worker<{ solicitacaoId: string }>(
  NOME_FILA_RELATORIOS,
  async (job) => {
    const { solicitacaoId } = job.data;
    const existente = await prisma.solicitacaoRelatorio.findUnique({ where: { id: solicitacaoId } });
    if (!existente) throw new Error('Solicitação de relatório não encontrada.');
    if (existente.status === 'CONCLUIDO') return { solicitacaoId, ignorado: true };
    const parametros = await solicitacoes.buscarSolicitacaoParaWorker(solicitacaoId);
    await prisma.solicitacaoRelatorio.update({
      where: { id: solicitacaoId },
      data: { status: 'PROCESSANDO', tentativas: { increment: 1 }, erroMensagem: null },
    });

    const resultado = existente.resultado
      ? (existente.resultado as unknown as { execucaoId: string })
      : await analises.executar(parametros.dataReferencia, parametros.organizacaoId, solicitacaoId);
    await mkdir(diretorioRelatorios, { recursive: true });
    const arquivoFinal = path.join(diretorioRelatorios, `${solicitacaoId}.json`);
    const arquivoTemporario = `${arquivoFinal}.${randomUUID()}.tmp`;
    await writeFile(arquivoTemporario, JSON.stringify(resultado, null, 2), { encoding: 'utf8', flag: 'wx' });
    await rename(arquivoTemporario, arquivoFinal);
    await prisma.solicitacaoRelatorio.update({
      where: { id: solicitacaoId },
      data: {
        status: 'CONCLUIDO',
        concluidoEm: new Date(),
        resultUrl: `/api/v1/public/relatorios/${solicitacaoId}/download`,
        erroMensagem: null,
      },
    });
    return { solicitacaoId, execucaoId: resultado.execucaoId };
  },
  { connection: conexao, concurrency: 2, lockDuration: 120_000, maxStalledCount: 1 },
);

worker.on('failed', async (job, erro) => {
  if (!job) return;
  const tentativasMaximas = Number(job.opts.attempts ?? 1);
  if (job.attemptsMade < tentativasMaximas) return;
  try {
    await prisma.solicitacaoRelatorio.updateMany({
      where: { id: job.data.solicitacaoId, status: { not: 'CONCLUIDO' } },
      data: { status: 'FALHOU', erroMensagem: 'Não foi possível gerar o relatório após as tentativas configuradas.', concluidoEm: new Date() },
    });
    console.error('Relatório falhou após tentativas', { solicitacaoId: job.data.solicitacaoId, erro: erro.message });
  } catch (erroPersistencia) {
    console.error('Falha ao atualizar solicitação após erro do worker', { solicitacaoId: job.data.solicitacaoId, erro: erroPersistencia });
  }
});

const timer = setInterval(() => {
  void solicitacoes.publicarPendentes().catch((erro: unknown) => {
    console.error('Falha ao publicar solicitações pendentes da outbox', erro);
  });
}, 5_000);
timer.unref();
void solicitacoes.publicarPendentes().catch((erro: unknown) => console.error('Falha ao iniciar despacho da outbox', erro));

let encerrando = false;
async function encerrar(): Promise<void> {
  if (encerrando) return;
  encerrando = true;
  clearInterval(timer);
  await worker.close();
  await fila.fechar();
  await conexao.quit();
  await prisma.$disconnect();
}
process.once('SIGINT', () => void encerrar());
process.once('SIGTERM', () => void encerrar());

console.info(`Worker de relatórios ativo na fila ${NOME_FILA_RELATORIOS}.`);
