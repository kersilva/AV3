import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { prisma } from '@infra/database.js';
import { AnaliseService } from '@analise/AnaliseService.js';
import { RelatorioApiService } from './RelatorioApiService.js';
import { RelatorioQueueClient } from './RelatorioQueue.js';
import { relatorioMetrics } from './RelatorioMetrics.js';

type ResumoRelatorio = { execucaoId: string; [chave: string]: unknown };

const solicitacoes = new RelatorioApiService(new RelatorioQueueClient());
const analises = new AnaliseService();

function diretorioSaida(): string {
  return process.env.REPORTS_DIR ?? path.resolve(process.cwd(), 'storage', 'relatorios');
}

function duracaoDesde(inicio: number): number {
  return Math.max(0, Math.round(performance.now() - inicio));
}

export async function processarRelatorioJob(
  solicitacaoId: string,
  tentativa: number,
  tentativasMaximas: number,
  hooks: { antesDeExecutarAnalise?: () => Promise<void> } = {},
): Promise<{ solicitacaoId: string; execucaoId?: string; ignorado?: boolean }> {
  const existente = await prisma.solicitacaoRelatorio.findUnique({ where: { id: solicitacaoId } });
  if (!existente) throw new Error('Solicitação de relatório não encontrada.');
  if (existente.status === 'CONCLUIDO' || existente.status === 'FALHOU' || existente.status === 'CANCELADO') {
    return { solicitacaoId, ignorado: true };
  }

  const parametros = await solicitacoes.buscarSolicitacaoParaWorker(solicitacaoId);
  const inicioRelogio = performance.now();
  const inicioParede = new Date();
  const primeiraTentativa = existente.processamentoIniciadoEm === null;
  await prisma.solicitacaoRelatorio.update({
    where: { id: solicitacaoId },
    data: {
      status: 'PROCESSANDO',
      tentativas: { increment: 1 },
      processamentoIniciadoEm: existente.processamentoIniciadoEm ?? inicioParede,
      ultimaTentativaIniciadaEm: inicioParede,
      erroMensagem: null,
    },
  });
  const numeroTentativa = Math.max(tentativa, existente.tentativas + 1);
  relatorioMetrics.iniciarTentativa(numeroTentativa);
  if (primeiraTentativa) {
    relatorioMetrics.observarEsperaFila(inicioParede.getTime() - existente.criadoEm.getTime());
  }

  try {
    const resultado: ResumoRelatorio = existente.resultado
      ? (existente.resultado as unknown as ResumoRelatorio)
      : await (async () => {
        await hooks.antesDeExecutarAnalise?.();
        return analises.executar(parametros.dataReferencia, parametros.organizacaoId, solicitacaoId);
      })();
    const duracaoMs = duracaoDesde(inicioRelogio);
    const diretorio = diretorioSaida();
    await mkdir(diretorio, { recursive: true });
    const arquivoFinal = path.join(diretorio, `${solicitacaoId}.json`);
    const arquivoTemporario = `${arquivoFinal}.${randomUUID()}.tmp`;
    await writeFile(arquivoTemporario, JSON.stringify(resultado, null, 2), { encoding: 'utf8', flag: 'wx' });
    await rename(arquivoTemporario, arquivoFinal);
    const concluidoEm = new Date();
    await prisma.solicitacaoRelatorio.update({
      where: { id: solicitacaoId },
      data: {
        status: 'CONCLUIDO',
        concluidoEm,
        resultUrl: `/api/v1/public/relatorios/${solicitacaoId}/download`,
        erroMensagem: null,
        duracaoProcessamentoMs: { increment: duracaoMs },
      },
    });
    relatorioMetrics.concluirTentativa('success', duracaoMs);
    relatorioMetrics.concluirSolicitacao('success', concluidoEm.getTime() - existente.criadoEm.getTime());
    console.info(JSON.stringify({
      evento: 'relatorio_tentativa_concluida', solicitacaoId, tentativa: numeroTentativa, resultado: 'success', duracaoMs,
    }));
    return { solicitacaoId, execucaoId: resultado.execucaoId };
  } catch (erro) {
    const duracaoMs = duracaoDesde(inicioRelogio);
    try {
      await prisma.solicitacaoRelatorio.update({
        where: { id: solicitacaoId },
        data: { duracaoProcessamentoMs: { increment: duracaoMs } },
      });
    } catch (erroPersistencia) {
      console.error(JSON.stringify({
        evento: 'relatorio_duracao_nao_persistida', solicitacaoId, tentativa,
        erro: erroPersistencia instanceof Error ? erroPersistencia.message : 'Erro desconhecido',
      }));
    }
    const resultado = numeroTentativa < tentativasMaximas ? 'retry' : 'failure';
    relatorioMetrics.concluirTentativa(resultado, duracaoMs);
    if (resultado === 'failure') {
      relatorioMetrics.concluirSolicitacao('failure', Date.now() - existente.criadoEm.getTime());
    }
    console.info(JSON.stringify({
      evento: 'relatorio_tentativa_concluida', solicitacaoId, tentativa: numeroTentativa, resultado, duracaoMs,
    }));
    throw erro;
  }
}
