import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyRequest, preHandlerHookHandler } from 'fastify';
import {
  EscopoApi as PrismaEscopoApi,
  type EscopoApi,
} from '@/generated/prisma/enums.js';
import { ErroAutenticacao, ErroConflito, ErroNaoEncontrado, ErroPermissao, ErroValidacao } from '@/shared/errors/DomainError.js';
import { prisma } from '@infra/database.js';
import { PrismaJournalTransacaoRepository } from '@infra/repositories/PrismaJournalTransacaoRepository.js';
import { PrismaJournalWriter } from '@infra/journal/PrismaJournalWriter.js';

export type ApiParceiroContext = {
  parceiroId: string;
  nome: string;
  organizacaoId: string;
  chaveId: string;
  escopos: EscopoApi[];
};

declare module 'fastify' {
  interface FastifyRequest {
    apiParceiro: ApiParceiroContext | null;
  }
}

const hashChave = (chave: string) => createHash('sha256').update(chave).digest('hex');

export class ApiKeyService {
  async criarParceiro(
    dados: { nome: string; emailContato: string; organizacaoId: string },
    ator: { id: string; usuario: string },
  ) {
    const organizacao = await prisma.organizacao.findFirst({
      where: { id: dados.organizacaoId, excluidoEm: null },
      select: { id: true },
    });
    if (!organizacao) throw new ErroNaoEncontrado('Organização ativa não encontrada.');
    const id = randomUUID();
    return prisma.$transaction(async (tx) => {
      const parceiro = await tx.parceiroApi.create({
        data: {
          id,
          nome: dados.nome.trim(),
          emailContato: dados.emailContato.trim(),
          organizacaoId: dados.organizacaoId,
        },
      });
      const journal = new PrismaJournalWriter(new PrismaJournalTransacaoRepository(tx));
      await journal.registrar({
        operacao: 'CRIAR_PARCEIRO_API', entidade: 'ParceiroApi', usuarioId: ator.id,
        usuarioResponsavel: ator.usuario,
        dadosDepois: { id, nome: parceiro.nome, emailContato: parceiro.emailContato, organizacaoId: parceiro.organizacaoId },
      });
      return parceiro;
    });
  }

  listarParceiros() {
    return prisma.parceiroApi.findMany({
      orderBy: { dataCriacao: 'desc' },
      include: {
        organizacao: { select: { id: true, razaoSocial: true } },
        chaves: { select: { id: true, prefixo: true, escopos: true, dataCriacao: true, dataRevogacao: true, ultimaVez: true } },
      },
    });
  }

  async criarChave(
    parceiroId: string,
    escopos: EscopoApi[],
    ator: { id: string; usuario: string },
  ) {
    if (escopos.length === 0 || escopos.some((escopo) => !Object.values(PrismaEscopoApi).includes(escopo))) {
      throw new ErroValidacao('Selecione ao menos um escopo válido para a chave.');
    }
    return prisma.$transaction(async (tx) => {
      const parceiro = await tx.parceiroApi.findUnique({ where: { id: parceiroId } });
      if (!parceiro) throw new ErroNaoEncontrado('Parceiro não encontrado.');
      if (!parceiro.ativo) throw new ErroConflito('Não é possível emitir chave para parceiro inativo.');
      const chave = `gc_live_${randomBytes(32).toString('base64url')}`;
      const prefixo = chave.slice(0, 18);
      const registro = await tx.chaveApi.create({
        data: {
          id: randomUUID(), parceiroId, chaveHash: hashChave(chave), prefixo, escopos,
        },
      });
      const journal = new PrismaJournalWriter(new PrismaJournalTransacaoRepository(tx));
      await journal.registrar({
        operacao: 'EMITIR_CHAVE_API', entidade: 'ChaveApi', usuarioId: ator.id,
        usuarioResponsavel: ator.usuario,
        dadosDepois: { id: registro.id, parceiroId, prefixo, escopos },
      });
      return { id: registro.id, prefixo, escopos: registro.escopos, chave };
    });
  }

  async revogarChave(id: string, ator: { id: string; usuario: string }) {
    return prisma.$transaction(async (tx) => {
      const chave = await tx.chaveApi.findUnique({ where: { id } });
      if (!chave) throw new ErroNaoEncontrado('Chave de API não encontrada.');
      if (chave.dataRevogacao) return { id, dataRevogacao: chave.dataRevogacao };
      const dataRevogacao = new Date();
      await tx.chaveApi.update({ where: { id }, data: { dataRevogacao } });
      const journal = new PrismaJournalWriter(new PrismaJournalTransacaoRepository(tx));
      await journal.registrar({
        operacao: 'REVOGAR_CHAVE_API', entidade: 'ChaveApi', usuarioId: ator.id,
        usuarioResponsavel: ator.usuario,
        dadosAntes: { id, parceiroId: chave.parceiroId, prefixo: chave.prefixo },
        dadosDepois: { id, dataRevogacao },
      });
      return { id, dataRevogacao };
    });
  }

  guard(escopo: EscopoApi): preHandlerHookHandler {
    return async (request: FastifyRequest) => this.autenticar(request, escopo);
  }

  private async autenticar(request: FastifyRequest, escopo: EscopoApi): Promise<void> {
    const token = request.headers['x-api-key'];
    if (typeof token !== 'string' || token.length < 20) {
      throw new ErroAutenticacao('Chave de API necessária.');
    }
    const registro = await prisma.chaveApi.findUnique({
      where: { chaveHash: hashChave(token) },
      include: { parceiro: { select: { id: true, nome: true, organizacaoId: true, ativo: true } } },
    });
    if (!registro || registro.dataRevogacao || !registro.parceiro.ativo) {
      throw new ErroAutenticacao('Chave de API inválida ou revogada.');
    }
    if (!registro.escopos.includes(escopo)) {
      throw new ErroPermissao('A chave de API não tem o escopo necessário.');
    }
    request.apiParceiro = {
      parceiroId: registro.parceiro.id,
      nome: registro.parceiro.nome,
      organizacaoId: registro.parceiro.organizacaoId,
      chaveId: registro.id,
      escopos: registro.escopos,
    };
    await prisma.chaveApi.update({ where: { id: registro.id }, data: { ultimaVez: new Date() } });
  }
}
