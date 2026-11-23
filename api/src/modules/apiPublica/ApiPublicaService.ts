import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@/generated/prisma/client.js';
import { prisma } from '@infra/database.js';
import { ErroConflito, ErroNaoEncontrado, ErroPermissao, ErroValidacao } from '@/shared/errors/DomainError.js';
import { PrismaJournalTransacaoRepository } from '@infra/repositories/PrismaJournalTransacaoRepository.js';
import { PrismaJournalWriter } from '@infra/journal/PrismaJournalWriter.js';
import type { ApiParceiroContext } from './ApiKeyService.js';

function ordenarJson(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(ordenarJson);
  if (typeof valor === 'object' && valor !== null) {
    return Object.fromEntries(Object.entries(valor).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, ordenarJson(v)]));
  }
  return valor;
}

function fingerprint(valor: unknown): string {
  return createHash('sha256').update(JSON.stringify(ordenarJson(valor))).digest('hex');
}

function codigoErro(erro: unknown): string | null {
  if (typeof erro !== 'object' || erro === null || !('code' in erro)) return null;
  return typeof erro.code === 'string' ? erro.code : null;
}

export type NovoLoteParceiro = {
  id: string;
  dataEntrada: Date;
  organizacaoId: string;
  notaFiscal: string;
  transportadora: string;
  observacoes?: string;
};

export class ApiPublicaService {
  async rastrearEquipamento(id: string, parceiro: ApiParceiroContext) {
    const equipamento = await prisma.equipamento.findFirst({
      where: { id, excluidoEm: null, lote: { is: { excluidoEm: null, organizacaoId: parceiro.organizacaoId } } },
      include: {
        lote: { select: { id: true, organizacaoId: true, dataEntrada: true } },
        historicoMovimentacao: { orderBy: { dataHora: 'asc' } },
        historicoEstadoFisico: { orderBy: { timestamp: 'asc' } },
      },
    });
    if (!equipamento) throw new ErroNaoEncontrado('Equipamento não encontrado para este parceiro.');
    return {
      id: equipamento.id,
      tipo: equipamento.tipo,
      marca: equipamento.marca,
      modelo: equipamento.modelo,
      estadoFisico: equipamento.estadoFisico,
      statusRastreamento: equipamento.statusRastreamento,
      lote: equipamento.lote,
      movimentacoes: equipamento.historicoMovimentacao.map((evento) => ({
        dataHora: evento.dataHora, origem: evento.origem, destino: evento.destino, observacao: evento.observacao,
      })),
      historicoEstadoFisico: equipamento.historicoEstadoFisico.map((evento) => ({
        timestamp: evento.timestamp, estadoAnterior: evento.estadoAnterior,
        estadoNovo: evento.estadoNovo, justificativa: evento.justificativa,
      })),
    };
  }

  async criarLote(dados: NovoLoteParceiro, parceiro: ApiParceiroContext, chaveIdempotencia: string | undefined) {
    if (!chaveIdempotencia || !chaveIdempotencia.trim() || chaveIdempotencia.length > 200) {
      throw new ErroValidacao('Envie o cabeçalho Idempotency-Key com até 200 caracteres.');
    }
    if (dados.organizacaoId !== parceiro.organizacaoId) {
      throw new ErroPermissao('O parceiro só pode criar lotes para sua organização vinculada.');
    }
    if (!Number.isFinite(dados.dataEntrada.getTime())) throw new ErroValidacao('A data de entrada do lote é inválida.');
    const requestFingerprint = fingerprint({ method: 'POST', path: '/api/v1/public/lotes', body: dados });

    try {
      return await prisma.$transaction(async (tx) => {
        const existente = await tx.idempotenciaApi.findUnique({
          where: { parceiroId_chave: { parceiroId: parceiro.parceiroId, chave: chaveIdempotencia } },
        });
        if (existente) {
          if (existente.fingerprint !== requestFingerprint) throw new ErroConflito('A chave Idempotency-Key já foi usada com outro conteúdo.');
          return { statusCode: existente.statusCode, body: existente.resposta, replayed: true };
        }
        const parceiroAtual = await tx.parceiroApi.findUnique({ where: { id: parceiro.parceiroId } });
        if (!parceiroAtual?.ativo || parceiroAtual.organizacaoId !== parceiro.organizacaoId) {
          throw new ErroPermissao('O parceiro não está ativo para esta organização.');
        }
        const organizacao = await tx.organizacao.findFirst({ where: { id: dados.organizacaoId, excluidoEm: null }, select: { id: true } });
        if (!organizacao) throw new ErroNaoEncontrado('Organização ativa não encontrada.');
        const lote = await tx.lote.create({
          data: {
            id: dados.id, dataEntrada: dados.dataEntrada, organizacaoId: dados.organizacaoId,
            notaFiscal: dados.notaFiscal, transportadora: dados.transportadora,
            observacoes: dados.observacoes ?? null, statusProcessamento: 'RECEBIDO',
          },
        });
        await tx.historicoStatusLote.create({
          data: { id: randomUUID(), loteId: lote.id, statusAnterior: null, statusNovo: 'RECEBIDO', responsavelId: null, observacao: `Criado pelo parceiro API ${parceiro.parceiroId}.` },
        });
        const resposta = {
          id: lote.id, dataEntrada: lote.dataEntrada.toISOString(), organizacaoId: lote.organizacaoId,
          notaFiscal: lote.notaFiscal, transportadora: lote.transportadora, observacoes: lote.observacoes,
          statusProcessamento: lote.statusProcessamento, versao: lote.versao,
        } satisfies Prisma.InputJsonValue;
        const journal = new PrismaJournalWriter(new PrismaJournalTransacaoRepository(tx));
        await journal.registrar({
          operacao: 'CRIAR_LOTE_API_PUBLICA', entidade: 'Lote', usuarioId: null,
          usuarioResponsavel: `PARCEIRO:${parceiro.nome}`, dadosDepois: resposta,
        });
        await tx.idempotenciaApi.create({
          data: { id: randomUUID(), parceiroId: parceiro.parceiroId, chave: chaveIdempotencia, fingerprint: requestFingerprint, statusCode: 201, resposta },
        });
        return { statusCode: 201, body: resposta, replayed: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (erro) {
      if (erro instanceof ErroConflito || (codigoErro(erro) !== 'P2002' && codigoErro(erro) !== 'P2034')) throw erro;
      const existente = await prisma.idempotenciaApi.findUnique({
        where: { parceiroId_chave: { parceiroId: parceiro.parceiroId, chave: chaveIdempotencia } },
      });
      if (existente?.fingerprint === requestFingerprint) return { statusCode: existente.statusCode, body: existente.resposta, replayed: true };
      if (existente) throw new ErroConflito('A chave Idempotency-Key já foi usada com outro conteúdo.');
      throw new ErroConflito('Conflito ao criar o lote idempotente; repita a requisição com a mesma chave.');
    }
  }
}
