import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@/generated/prisma/client.js';
import { ErroConflito, ErroNaoEncontrado, ErroPermissao, ErroValidacao } from '@/shared/errors/DomainError.js';
import { prisma } from '@infra/database.js';
import type { ApiParceiroContext } from './ApiKeyService.js';
import { RelatorioQueueClient } from './RelatorioQueue.js';

type PublicadorRelatorio = Pick<RelatorioQueueClient, 'publicar' | 'consultarJob' | 'removerJobTerminal'>;

function hashCorpo(valor: unknown): string {
  return createHash('sha256').update(JSON.stringify(valor)).digest('hex');
}

function lerPropriedadeString(valor: Prisma.JsonValue, chave: string): string | null {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return null;
  const propriedade = valor[chave];
  return typeof propriedade === 'string' ? propriedade : null;
}

function codigoPrisma(erro: unknown): string | null {
  if (typeof erro !== 'object' || erro === null || !('code' in erro)) return null;
  return typeof erro.code === 'string' ? erro.code : null;
}

export class RelatorioApiService {
  constructor(private readonly fila: PublicadorRelatorio) {}

  async solicitar(
    parceiro: ApiParceiroContext,
    dados: { dataReferencia?: string },
    chaveIdempotencia: string | undefined,
  ) {
    if (!chaveIdempotencia || !chaveIdempotencia.trim() || chaveIdempotencia.length > 200) {
      throw new ErroValidacao('Envie o cabeçalho Idempotency-Key com até 200 caracteres.');
    }
    const dataReferencia = dados.dataReferencia ? new Date(dados.dataReferencia) : new Date();
    if (!Number.isFinite(dataReferencia.getTime())) throw new ErroValidacao('A data de referência é inválida.');
    const requisicaoFingerprint = hashCorpo({ tipoRelatorio: 'COMPLETO', dataReferencia: dados.dataReferencia ?? null });
    let resultado;
    try {
      resultado = await prisma.$transaction(async (tx) => {
        const parceiroAtual = await tx.parceiroApi.findUnique({ where: { id: parceiro.parceiroId } });
        if (!parceiroAtual?.ativo || parceiroAtual.organizacaoId !== parceiro.organizacaoId) {
          throw new ErroPermissao('O parceiro não está ativo para esta organização.');
        }
        const existente = await tx.solicitacaoRelatorio.findFirst({
          where: { parceiroId: parceiro.parceiroId, chaveIdempotencia },
        });
        if (existente) {
          const fingerprintSalvo = lerPropriedadeString(existente.parametros, 'requisicaoFingerprint');
          if (fingerprintSalvo !== requisicaoFingerprint) {
            throw new ErroConflito('A chave Idempotency-Key já foi usada com outra solicitação.');
          }
          return { id: existente.id, status: existente.status, replayed: true };
        }
        const solicitacaoId = randomUUID();
        await tx.solicitacaoRelatorio.create({
          data: {
            id: solicitacaoId,
            parceiroId: parceiro.parceiroId,
            tipoRelatorio: 'COMPLETO',
            parametros: {
              organizacaoId: parceiro.organizacaoId,
              dataReferencia: dataReferencia.toISOString(),
              requisicaoFingerprint,
            },
            chaveIdempotencia,
            outbox: { create: { id: randomUUID() } },
          },
        });
        return { id: solicitacaoId, status: 'PENDENTE' as const, replayed: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (erro) {
      if (codigoPrisma(erro) !== 'P2002' && codigoPrisma(erro) !== 'P2034') throw erro;
      const existente = await prisma.solicitacaoRelatorio.findFirst({
        where: { parceiroId: parceiro.parceiroId, chaveIdempotencia },
      });
      if (!existente) throw erro;
      const fingerprintSalvo = lerPropriedadeString(existente.parametros, 'requisicaoFingerprint');
      if (fingerprintSalvo !== requisicaoFingerprint) {
        throw new ErroConflito('A chave Idempotency-Key já foi usada com outra solicitação.');
      }
      resultado = { id: existente.id, status: existente.status, replayed: true };
    }

    try {
      await this.publicarPendente(resultado.id);
    } catch {
      // A solicitação e a outbox já estão persistidas. O worker reenfileira pendências.
    }
    return { ...resultado, statusUrl: `/api/v1/public/relatorios/${resultado.id}` };
  }

  async publicarPendente(solicitacaoId: string): Promise<void> {
    const outbox = await prisma.outboxRelatorio.findUnique({ where: { solicitacaoId } });
    if (!outbox || outbox.status === 'PUBLICADO') return;
    await this.fila.publicar(solicitacaoId);
    await prisma.$transaction([
      prisma.outboxRelatorio.update({
        where: { solicitacaoId }, data: { status: 'PUBLICADO', publicadoEm: new Date() },
      }),
      prisma.solicitacaoRelatorio.update({
        where: { id: solicitacaoId }, data: { jobIdFila: solicitacaoId },
      }),
    ]);
  }

  async publicarPendentes(): Promise<void> {
    const pendentes = await prisma.outboxRelatorio.findMany({
      where: { status: 'PENDENTE' }, orderBy: { criadoEm: 'asc' }, take: 50,
      select: { solicitacaoId: true },
    });
    for (const item of pendentes) await this.publicarPendente(item.solicitacaoId);
    await this.reconciliarPublicados();
  }

  private async reconciliarPublicados(): Promise<void> {
    const publicadas = await prisma.outboxRelatorio.findMany({
      where: {
        status: 'PUBLICADO',
        solicitacao: { status: { in: ['PENDENTE', 'PROCESSANDO'] } },
      },
      orderBy: { publicadoEm: 'asc' },
      take: 50,
      include: {
        solicitacao: {
          select: { status: true, criadoEm: true, ultimaTentativaIniciadaEm: true },
        },
      },
    });
    const agora = Date.now();
    const idadePublicacaoMinima = Math.max(0, Number(process.env.RELATORIO_OUTBOX_STALE_PUBLISH_MS ?? 5_000) || 5_000);
    const idadeProcessamentoMaxima = Math.max(0, Number(process.env.RELATORIO_PROCESSAMENTO_STALE_MS ?? 600_000) || 600_000);

    for (const item of publicadas) {
      const referencia = item.solicitacao.ultimaTentativaIniciadaEm ?? item.publicadoEm ?? item.criadoEm;
      const limite = item.solicitacao.status === 'PROCESSANDO'
        ? idadeProcessamentoMaxima
        : idadePublicacaoMinima;
      if (agora - referencia.getTime() < limite) continue;

      const job = await this.fila.consultarJob(item.solicitacaoId);
      if (job && ['active', 'waiting', 'delayed', 'paused', 'waiting-children', 'prioritized'].includes(job.state)) {
        continue;
      }
      if (job) await this.fila.removerJobTerminal(item.solicitacaoId);

      const atualizada = await prisma.outboxRelatorio.updateMany({
        where: { solicitacaoId: item.solicitacaoId, status: 'PUBLICADO' },
        data: { status: 'PENDENTE', publicadoEm: null },
      });
      if (atualizada.count > 0) await this.publicarPendente(item.solicitacaoId);
    }
  }

  async buscarStatus(id: string, parceiroId: string) {
    const solicitacao = await prisma.solicitacaoRelatorio.findFirst({
      where: { id, parceiroId },
      select: {
        id: true, tipoRelatorio: true, status: true, criadoEm: true, concluidoEm: true,
        resultUrl: true, erroMensagem: true, tentativas: true, processamentoIniciadoEm: true,
        ultimaTentativaIniciadaEm: true, duracaoProcessamentoMs: true,
      },
    });
    if (!solicitacao) throw new ErroNaoEncontrado('Solicitação de relatório não encontrada.');
    return solicitacao;
  }

  async buscarSolicitacaoParaWorker(id: string) {
    const solicitacao = await prisma.solicitacaoRelatorio.findUnique({ where: { id } });
    if (!solicitacao) throw new ErroNaoEncontrado('Solicitação de relatório não encontrada.');
    const organizacaoId = lerPropriedadeString(solicitacao.parametros, 'organizacaoId');
    const referencia = lerPropriedadeString(solicitacao.parametros, 'dataReferencia');
    if (!organizacaoId || !referencia) throw new ErroValidacao('Parâmetros persistidos da solicitação são inválidos.');
    return { solicitacao, organizacaoId, dataReferencia: new Date(referencia) };
  }

  async buscarArquivo(id: string, parceiroId: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      throw new ErroNaoEncontrado('Relatório não encontrado.');
    }
    const solicitacao = await prisma.solicitacaoRelatorio.findFirst({
      where: { id, parceiroId, status: 'CONCLUIDO' }, select: { id: true },
    });
    if (!solicitacao) throw new ErroNaoEncontrado('Relatório concluído não encontrado.');
    return solicitacao.id;
  }
}
