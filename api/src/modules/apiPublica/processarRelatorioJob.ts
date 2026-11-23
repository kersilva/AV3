import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { DelayedError, type Job } from 'bullmq';
import { prisma } from '@infra/database.js';
import { AnaliseService } from '@analise/AnaliseService.js';
import { RelatorioApiService } from './RelatorioApiService.js';
import { RelatorioQueueClient } from './RelatorioQueue.js';
import { relatorioMetrics } from './RelatorioMetrics.js';

type ResumoRelatorio = { execucaoId: string; [chave: string]: unknown };
const LEASE_MS = Number(process.env.RELATORIO_LEASE_MS ?? 120_000);
const RENOVACAO_LEASE_MS = Number(process.env.RELATORIO_LEASE_RENEW_MS ?? 30_000);

type Claim = { claimVersion: number };

async function adquirirClaim(solicitacaoId: string, token: string): Promise<Claim | null> {
  const claims = await prisma.$queryRaw<Claim[]>`
    UPDATE "SolicitacaoRelatorio"
    SET "status" = 'PROCESSANDO',
        "tentativas" = "tentativas" + 1,
        "processamentoIniciadoEm" = COALESCE("processamentoIniciadoEm", NOW()),
        "ultimaTentativaIniciadaEm" = NOW(),
        "erroMensagem" = NULL,
        "leaseToken" = ${token},
        "leaseExpiresAt" = NOW() + (${LEASE_MS} * INTERVAL '1 millisecond'),
        "claimVersion" = "claimVersion" + 1
    WHERE "id" = ${solicitacaoId}
      AND "status" NOT IN ('CONCLUIDO', 'FALHOU', 'CANCELADO')
      AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= NOW())
    RETURNING "claimVersion"
  `;
  return claims[0] ?? null;
}

async function atualizarClaim(solicitacaoId: string, token: string, claimVersion: number, dados: object): Promise<void> {
  const resultado = await prisma.solicitacaoRelatorio.updateMany({
    where: { id: solicitacaoId, leaseToken: token, claimVersion, status: 'PROCESSANDO' },
    data: dados,
  });
  if (resultado.count !== 1) throw new Error('A reivindicação do processamento foi perdida.');
}

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
  hooks: { antesDeExecutarAnalise?: () => Promise<void>; job?: Job } = {},
): Promise<{ solicitacaoId: string; execucaoId?: string; ignorado?: boolean }> {
  const existente = await prisma.solicitacaoRelatorio.findUnique({ where: { id: solicitacaoId } });
  if (!existente) throw new Error('Solicitação de relatório não encontrada.');
  if (existente.status === 'CONCLUIDO' || existente.status === 'FALHOU' || existente.status === 'CANCELADO') {
    return { solicitacaoId, ignorado: true };
  }

  const token = randomUUID();
  const claim = await adquirirClaim(solicitacaoId, token);
  if (!claim) {
    if (hooks.job?.token) {
      await hooks.job.moveToDelayed(Date.now() + 2_000, hooks.job.token);
      throw new DelayedError();
    }
    throw new Error('Solicitação já está sendo processada por outro worker.');
  }
  const solicitacaoReivindicada = await prisma.solicitacaoRelatorio.findUniqueOrThrow({ where: { id: solicitacaoId } });
  const parametros = await solicitacoes.buscarSolicitacaoParaWorker(solicitacaoId);
  const inicioRelogio = performance.now();
  const inicioParede = new Date();
  const primeiraTentativa = solicitacaoReivindicada.tentativas === 1;
  const numeroTentativa = Math.max(tentativa, solicitacaoReivindicada.tentativas);
  relatorioMetrics.iniciarTentativa(numeroTentativa);
  if (primeiraTentativa) {
    relatorioMetrics.observarEsperaFila(inicioParede.getTime() - existente.criadoEm.getTime());
  }

  let renovando = false;
  const renovador = setInterval(() => {
    if (renovando) return;
    renovando = true;
    void prisma.solicitacaoRelatorio.updateMany({
      where: { id: solicitacaoId, leaseToken: token, claimVersion: claim.claimVersion, status: 'PROCESSANDO' },
      data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) },
    }).then((result) => {
      if (result.count !== 1) console.error(JSON.stringify({ evento: 'relatorio_lease_perdido', solicitacaoId }));
    }).catch((erro: unknown) => console.error(JSON.stringify({ evento: 'relatorio_lease_renovacao_falhou', solicitacaoId, erro })))
      .finally(() => { renovando = false; });
  }, RENOVACAO_LEASE_MS);
  renovador.unref();
  try {
    const resultado: ResumoRelatorio = solicitacaoReivindicada.resultado
      ? (solicitacaoReivindicada.resultado as unknown as ResumoRelatorio)
      : await (async () => {
        await hooks.antesDeExecutarAnalise?.();
        await atualizarClaim(solicitacaoId, token, claim.claimVersion, {});
        return analises.executar(parametros.dataReferencia, parametros.organizacaoId, solicitacaoId);
      })();
    await atualizarClaim(solicitacaoId, token, claim.claimVersion, {});
    const duracaoMs = duracaoDesde(inicioRelogio);
    const diretorio = diretorioSaida();
    await mkdir(diretorio, { recursive: true });
    const arquivoFinal = path.join(diretorio, `${solicitacaoId}.json`);
    const arquivoTemporario = `${arquivoFinal}.${randomUUID()}.tmp`;
    await writeFile(arquivoTemporario, JSON.stringify(resultado, null, 2), { encoding: 'utf8', flag: 'wx' });
    await rename(arquivoTemporario, arquivoFinal);
    const concluidoEm = new Date();
    await atualizarClaim(solicitacaoId, token, claim.claimVersion, {
        status: 'CONCLUIDO',
        concluidoEm,
        resultUrl: `/api/v1/public/relatorios/${solicitacaoId}/download`,
        erroMensagem: null,
        duracaoProcessamentoMs: { increment: duracaoMs },
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
      await atualizarClaim(solicitacaoId, token, claim.claimVersion, {
        duracaoProcessamentoMs: { increment: duracaoMs }, leaseToken: null, leaseExpiresAt: null,
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
  } finally {
    clearInterval(renovador);
    await prisma.solicitacaoRelatorio.updateMany({
      where: { id: solicitacaoId, leaseToken: token, claimVersion: claim.claimVersion },
      data: { leaseToken: null, leaseExpiresAt: null },
    });
  }
}
