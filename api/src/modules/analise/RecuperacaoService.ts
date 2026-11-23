import { randomUUID } from 'node:crypto';
import { EstadoFisico } from '@domain/enums/EstadoFisico.js';
import { ErroConflito, ErroNaoEncontrado, ErroRegraNegocio, ErroValidacao } from '@/shared/errors/DomainError.js';
import {
  EstadoFisico as PrismaEstadoFisico,
  NivelEstimativaRecuperacao as PrismaNivelEstimativa,
  StatusRastreamento as PrismaStatusRastreamento,
} from '@/generated/prisma/enums.js';
import { prisma } from '@infra/database.js';
import { PrismaJournalTransacaoRepository } from '@infra/repositories/PrismaJournalTransacaoRepository.js';
import { PrismaJournalWriter } from '@infra/journal/PrismaJournalWriter.js';
import { estimarRecuperacao } from './AnaliseCalculos.js';
import type { AmostraRecuperacao } from './AnaliseCalculos.js';

const ESTADO_PARA_DOMINIO: Record<PrismaEstadoFisico, EstadoFisico> = {
  NOVO: EstadoFisico.NOVO,
  BOM_ESTADO: EstadoFisico.BOM_ESTADO,
  USADO_LEVE: EstadoFisico.USADO_LEVE,
  USADO_MODERADO: EstadoFisico.USADO_MODERADO,
  DANIFICADO_LEVE: EstadoFisico.DANIFICADO_LEVE,
  DANIFICADO_GRAVE: EstadoFisico.DANIFICADO_GRAVE,
  INSERVIVEL: EstadoFisico.INSERVIVEL,
};

export class RecuperacaoService {
  async estimar(id: string, versao: number, ator: { id: string; usuario: string }) {
    return prisma.$transaction(async (tx) => {
      const dataEstimativa = new Date();
      const equipamento = await tx.equipamento.findFirst({
        where: { id, excluidoEm: null, lote: { is: { excluidoEm: null } } },
      });
      if (!equipamento) throw new ErroNaoEncontrado('Equipamento não encontrado.');
      if (equipamento.versao !== versao) throw new ErroConflito('Conflito de versão do equipamento.');
      if (equipamento.statusRastreamento !== PrismaStatusRastreamento.EM_TRIAGEM) {
        throw new ErroRegraNegocio('A estimativa só pode ser gerada durante a triagem.');
      }
      if (equipamento.dataEstimativa) throw new ErroRegraNegocio('O equipamento já tem uma estimativa registrada.');

      const candidatos = await tx.equipamento.findMany({
        where: {
          excluidoEm: null,
          lote: { is: { excluidoEm: null } },
          valorRealizadoRecuperacao: { not: null },
          dataRealizacao: { not: null },
          referenciaComprovante: { not: null },
        },
      });
      const historicos = candidatos.length
        ? await tx.historicoEstadoFisico.findMany({
            where: { equipamentoId: { in: candidatos.map((item) => item.id) } },
            orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
          })
        : [];
      const historicoPorEquipamento = new Map<string, typeof historicos>();
      for (const evento of historicos) {
        const lista = historicoPorEquipamento.get(evento.equipamentoId) ?? [];
        lista.push(evento);
        historicoPorEquipamento.set(evento.equipamentoId, lista);
      }
      const amostras: AmostraRecuperacao[] = [];
      for (const candidato of candidatos) {
        if (candidato.valorRealizadoRecuperacao === null || !candidato.dataRealizacao || !candidato.referenciaComprovante?.trim()) {
          continue;
        }
        const estado = [...(historicoPorEquipamento.get(candidato.id) ?? [])]
          .filter((evento) => evento.timestamp <= dataEstimativa)
          .at(-1)?.estadoNovo;
        if (!estado) continue;
        amostras.push({
          id: candidato.id,
          tipo: candidato.tipo,
          estado: ESTADO_PARA_DOMINIO[estado],
          marca: candidato.marca,
          modelo: candidato.modelo,
          valor: Number(candidato.valorRealizadoRecuperacao),
          dataRealizacao: candidato.dataRealizacao,
          referenciaComprovante: candidato.referenciaComprovante,
        });
      }
      const historicoAtual = await tx.historicoEstadoFisico.findMany({
        where: { equipamentoId: id, timestamp: { lte: new Date() } },
        orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
      });
      const estadoAtual = historicoAtual.at(-1)?.estadoNovo;
      if (!estadoAtual) throw new ErroRegraNegocio('O equipamento não tem histórico de estado físico.');
      const estimativa = estimarRecuperacao(
        {
          tipo: equipamento.tipo,
          estado: ESTADO_PARA_DOMINIO[estadoAtual],
          marca: equipamento.marca,
          modelo: equipamento.modelo,
        },
        amostras,
      );
      if (!estimativa) throw new ErroRegraNegocio('Não há amostras válidas para estimar a recuperação.');

      const salvo = await tx.equipamento.updateMany({
        where: { id, versao, dataEstimativa: null, excluidoEm: null },
        data: {
          valorEstimadoRecuperacao: estimativa.valor,
          dataEstimativa,
          amostrasEstimativa: estimativa.quantidadeAmostras,
          nivelEstimativa: estimativa.nivel === 'COMPLETO'
            ? PrismaNivelEstimativa.CORRESPONDENCIA_COMPLETA
            : PrismaNivelEstimativa.TIPO_ESTADO,
          versao: { increment: 1 },
        },
      });
      if (!salvo.count) throw new ErroConflito('Conflito ao gravar a estimativa do equipamento.');
      const journal = new PrismaJournalWriter(new PrismaJournalTransacaoRepository(tx));
      await journal.registrar({
        operacao: 'REGISTRAR_ESTIMATIVA_RECUPERACAO',
        entidade: 'Equipamento',
        usuarioId: ator.id,
        usuarioResponsavel: ator.usuario,
        dadosAntes: { id, valorEstimadoRecuperacao: equipamento.valorEstimadoRecuperacao ? Number(equipamento.valorEstimadoRecuperacao) : null },
        dadosDepois: {
          id,
          valorEstimadoRecuperacao: estimativa.valor,
          amostrasEstimativa: estimativa.quantidadeAmostras,
          nivelEstimativa: estimativa.nivel,
        },
      });
      return {
        equipamentoId: id,
        valorEstimadoRecuperacao: estimativa.valor,
        dataEstimativa,
        versao: versao + 1,
        amostras: estimativa.quantidadeAmostras,
        nivel: estimativa.nivel,
        dadosDemonstracao: amostras.some((amostra) => amostra.referenciaComprovante?.startsWith('DEMO-SEED:')),
      };
    });
  }

  async buscar(id: string) {
    const equipamento = await prisma.equipamento.findFirst({
      where: { id, excluidoEm: null, lote: { is: { excluidoEm: null } } },
      select: {
        id: true,
        valorEstimadoRecuperacao: true,
        dataEstimativa: true,
        amostrasEstimativa: true,
        nivelEstimativa: true,
        valorRealizadoRecuperacao: true,
        dataRealizacao: true,
        referenciaComprovante: true,
        versao: true,
      },
    });
    if (!equipamento) throw new ErroNaoEncontrado('Equipamento não encontrado.');
    return {
      equipamentoId: equipamento.id,
      valorEstimadoRecuperacao: equipamento.valorEstimadoRecuperacao === null
        ? null
        : Number(equipamento.valorEstimadoRecuperacao),
      dataEstimativa: equipamento.dataEstimativa,
      amostrasEstimativa: equipamento.amostrasEstimativa,
      nivelEstimativa: equipamento.nivelEstimativa,
      valorRealizadoRecuperacao: equipamento.valorRealizadoRecuperacao === null
        ? null
        : Number(equipamento.valorRealizadoRecuperacao),
      dataRealizacao: equipamento.dataRealizacao,
      referenciaComprovante: equipamento.referenciaComprovante,
      versao: equipamento.versao,
    };
  }

  async registrarRealizado(
    id: string,
    dados: { valor: number; dataRealizacao: Date; referenciaComprovante: string; versao: number },
    ator: { id: string; usuario: string },
  ) {
    const referencia = dados.referenciaComprovante.trim();
    if (!Number.isFinite(dados.valor) || dados.valor < 0) {
      throw new ErroValidacao('O valor realizado deve ser um número igual ou maior que zero.');
    }
    if (!Number.isFinite(dados.dataRealizacao.getTime()) || dados.dataRealizacao > new Date()) {
      throw new ErroValidacao('A data de realização deve ser válida e não pode estar no futuro.');
    }
    if (!referencia || referencia.length > 200) {
      throw new ErroValidacao('Informe uma referência de comprovante de até 200 caracteres.');
    }

    return prisma.$transaction(async (tx) => {
      const equipamento = await tx.equipamento.findFirst({
        where: { id, excluidoEm: null, lote: { is: { excluidoEm: null } } },
      });
      if (!equipamento) throw new ErroNaoEncontrado('Equipamento não encontrado.');
      if (equipamento.versao !== dados.versao) throw new ErroConflito('Conflito de versão do equipamento.');
      const estadosQuePermitemRegistro = [
        PrismaStatusRastreamento.PECAS_REAPROVEITADAS,
        PrismaStatusRastreamento.MATERIAL_RECICLAVEL,
        PrismaStatusRastreamento.DESCARTE_SEGURO,
        PrismaStatusRastreamento.BAIXA_DEFINITIVA,
      ];
      if (!estadosQuePermitemRegistro.some((status) => status === equipamento.statusRastreamento)) {
        throw new ErroRegraNegocio('O valor realizado só pode ser informado após o desmonte.');
      }
      const antes = {
        id,
        valorRealizadoRecuperacao: equipamento.valorRealizadoRecuperacao
          ? Number(equipamento.valorRealizadoRecuperacao)
          : null,
        dataRealizacao: equipamento.dataRealizacao,
        referenciaComprovante: equipamento.referenciaComprovante,
      };
      const salvo = await tx.equipamento.updateMany({
        where: { id, versao: dados.versao, excluidoEm: null },
        data: {
          valorRealizadoRecuperacao: dados.valor,
          dataRealizacao: dados.dataRealizacao,
          referenciaComprovante: referencia,
          versao: { increment: 1 },
        },
      });
      if (!salvo.count) throw new ErroConflito('Conflito ao gravar o valor realizado.');
      const journal = new PrismaJournalWriter(new PrismaJournalTransacaoRepository(tx));
      await journal.registrar({
        operacao: 'REGISTRAR_RECUPERACAO_REALIZADA',
        entidade: 'Equipamento',
        usuarioId: ator.id,
        usuarioResponsavel: ator.usuario,
        dadosAntes: antes,
        dadosDepois: {
          id,
          valorRealizadoRecuperacao: dados.valor,
          dataRealizacao: dados.dataRealizacao,
          referenciaComprovante: referencia,
        },
      });
      return {
        equipamentoId: id,
        valorRealizadoRecuperacao: dados.valor,
        dataRealizacao: dados.dataRealizacao,
        referenciaComprovante: referencia,
        versao: dados.versao + 1,
      };
    });
  }
}
