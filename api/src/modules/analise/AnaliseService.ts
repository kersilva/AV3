import { randomUUID } from 'node:crypto';
import { EstadoFisico } from '@domain/enums/EstadoFisico.js';
import { TipoEquipamento } from '@domain/enums/TipoEquipamento.js';
import { ORDEM_ESTADO } from '@domain/entities/Equipamento.js';
import {
  EstadoFisico as PrismaEstadoFisico,
  MetricaAnalise as PrismaMetricaAnalise,
} from '@/generated/prisma/enums.js';
import { prisma } from '@infra/database.js';
import { calcularEficienciaLotes, calcularOlsVidaUtil, mesesEntre } from './AnaliseCalculos.js';
import type { AmostraRecuperacao, ObservacaoRegressao } from './AnaliseCalculos.js';

const VERSAO_CALCULO = '1.0.0';
const ESTADO_PARA_DOMINIO: Record<PrismaEstadoFisico, EstadoFisico> = {
  NOVO: EstadoFisico.NOVO,
  BOM_ESTADO: EstadoFisico.BOM_ESTADO,
  USADO_LEVE: EstadoFisico.USADO_LEVE,
  USADO_MODERADO: EstadoFisico.USADO_MODERADO,
  DANIFICADO_LEVE: EstadoFisico.DANIFICADO_LEVE,
  DANIFICADO_GRAVE: EstadoFisico.DANIFICADO_GRAVE,
  INSERVIVEL: EstadoFisico.INSERVIVEL,
};

type ResultadoMetricas = {
  metrica: (typeof PrismaMetricaAnalise)[keyof typeof PrismaMetricaAnalise];
  chave?: string;
  valor: number;
  amostras: number;
};

function inicioDoMesUtc(data: Date): string {
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, '0')}`;
}

export class AnaliseService {
  async executar(dataReferencia = new Date(), organizacaoId?: string, solicitacaoRelatorioId?: string) {
    if (!Number.isFinite(dataReferencia.getTime())) {
      throw new Error('A data de referência da análise é inválida.');
    }

    return prisma.$transaction(async (tx) => {
      const lotes = await tx.lote.findMany({
        where: {
          excluidoEm: null,
          dataEntrada: { lte: dataReferencia },
          ...(organizacaoId ? { organizacaoId } : {}),
          organizacao: { is: { excluidoEm: null } },
        },
        select: { id: true, dataEntrada: true },
      });
      const idsLote = lotes.map((lote) => lote.id);
      const historicoLote = idsLote.length
        ? await tx.historicoStatusLote.findMany({
            where: { loteId: { in: idsLote }, timestamp: { lte: dataReferencia } },
            orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
          })
        : [];
      const equipamentos = idsLote.length
        ? await tx.equipamento.findMany({
            where: { excluidoEm: null, loteId: { in: idsLote } },
            include: { lote: { select: { dataEntrada: true } } },
          })
        : [];
      const idsEquipamento = equipamentos.map((item) => item.id);
      const historicoFisico = idsEquipamento.length
        ? await tx.historicoEstadoFisico.findMany({
            where: { equipamentoId: { in: idsEquipamento }, timestamp: { lte: dataReferencia } },
            orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
          })
        : [];

      const metricas: ResultadoMetricas[] = [];
      const eficiencia = calcularEficienciaLotes(lotes, historicoLote);
      const duracoes = eficiencia.concluidos;

      metricas.push({ metrica: 'EFICIENCIA_LOTES_CONCLUIDOS', valor: duracoes.length, amostras: duracoes.length });
      metricas.push({
        metrica: 'EFICIENCIA_LOTES_PENDENTES',
        valor: eficiencia.pendentes,
        amostras: lotes.length,
      });
      if (duracoes.length) {
        metricas.push({
          metrica: 'EFICIENCIA_TEMPO_MEDIO_TRIAGEM_HORAS',
          valor: duracoes.reduce((soma, item) => soma + item.horas, 0) / duracoes.length,
          amostras: duracoes.length,
        });
      }
      const gruposEficiencia = new Map<string, number[]>();
      for (const duracao of duracoes) {
        const chaves = [
          `mes=${inicioDoMesUtc(duracao.conclusao)}`,
          `operador=${duracao.responsavelId ?? 'SEM_RESPONSAVEL'}`,
        ];
        for (const chave of chaves) {
          const valores = gruposEficiencia.get(chave) ?? [];
          valores.push(duracao.horas);
          gruposEficiencia.set(chave, valores);
        }
      }
      for (const [chave, valores] of gruposEficiencia) {
        metricas.push({
          metrica: 'EFICIENCIA_TEMPO_MEDIO_TRIAGEM_HORAS',
          chave,
          valor: valores.reduce((soma, item) => soma + item, 0) / valores.length,
          amostras: valores.length,
        });
      }

      const eventosFisicosPorEquipamento = new Map<string, typeof historicoFisico>();
      for (const evento of historicoFisico) {
        const eventos = eventosFisicosPorEquipamento.get(evento.equipamentoId) ?? [];
        eventos.push(evento);
        eventosFisicosPorEquipamento.set(evento.equipamentoId, eventos);
      }

      const amostrasRecuperacao: AmostraRecuperacao[] = [];
      for (const equipamento of equipamentos) {
        if (
          equipamento.valorRealizadoRecuperacao === null ||
          equipamento.dataRealizacao === null ||
          !equipamento.referenciaComprovante?.trim() ||
          equipamento.dataRealizacao > dataReferencia
        ) continue;
        const estadoNaRealizacao = [...(eventosFisicosPorEquipamento.get(equipamento.id) ?? [])]
          .filter((evento) => evento.timestamp <= equipamento.dataRealizacao!)
          .at(-1)?.estadoNovo;
        if (!estadoNaRealizacao) continue;
        amostrasRecuperacao.push({
          id: equipamento.id,
          tipo: equipamento.tipo,
          estado: ESTADO_PARA_DOMINIO[estadoNaRealizacao],
          marca: equipamento.marca,
          modelo: equipamento.modelo,
          valor: Number(equipamento.valorRealizadoRecuperacao),
          dataRealizacao: equipamento.dataRealizacao,
          referenciaComprovante: equipamento.referenciaComprovante,
        });
      }
      const valoresPorTipo = new Map<string, number[]>();
      for (const amostra of amostrasRecuperacao) {
        const valores = valoresPorTipo.get(amostra.tipo) ?? [];
        valores.push(amostra.valor);
        valoresPorTipo.set(amostra.tipo, valores);
      }
      for (const [tipo, valores] of valoresPorTipo) {
        metricas.push({
          metrica: 'RECUPERACAO_MEDIA_BRUTA',
          chave: `tipo=${tipo}`,
          valor: valores.reduce((soma, valor) => soma + valor, 0) / valores.length,
          amostras: valores.length,
        });
        metricas.push({ metrica: 'RECUPERACAO_AMOSTRAS', chave: `tipo=${tipo}`, valor: valores.length, amostras: valores.length });
      }

      const previsoes: {
        id: string;
        tipoEquipamento: (typeof equipamentos)[number]['tipo'];
        dataPrevisao: Date;
        metodologia: 'REGRESSAO_OLS';
        vidaUtilEstimadaMeses: number;
        r2: number | null;
        amostras: number;
        parametros: { inclinacao: number; intercepto: number; falhas: number; emUso: number };
      }[] = [];
      const previsoesPorTipo: {
        tipoEquipamento: string;
        status: 'PREVISAO_PUBLICADA' | 'DADOS_INSUFICIENTES' | 'MODELO_INVALIDO';
        falhas: number;
        emUso: number;
        motivo?: string;
      }[] = [];
      const vidaRestantePorEquipamento: {
        tipo: string;
        equipamentoId: string;
        idadeAtualMeses: number;
        vidaRestanteMeses: number;
        idadeExcedeuEstimativa: boolean;
      }[] = [];
      const eventosPorTipo = new Map<string, ObservacaoRegressao[]>();
      const falhasPorTipo = new Map<string, Set<string>>();
      const idsPorTipo = new Map<string, Set<string>>();
      const equipamentoPorId = new Map(equipamentos.map((item) => [item.id, item]));

      for (const equipamento of equipamentos) {
        const eventos = eventosFisicosPorEquipamento.get(equipamento.id) ?? [];
        const observacoes = eventosPorTipo.get(equipamento.tipo) ?? [];
        const ids = idsPorTipo.get(equipamento.tipo) ?? new Set<string>();
        ids.add(equipamento.id);
        idsPorTipo.set(equipamento.tipo, ids);
        const falha = eventos.find((evento) => evento.estadoNovo === PrismaEstadoFisico.INSERVIVEL);
        if (falha) {
          const falhas = falhasPorTipo.get(equipamento.tipo) ?? new Set<string>();
          falhas.add(equipamento.id);
          falhasPorTipo.set(equipamento.tipo, falhas);
        }
        for (const evento of eventos) {
          const posicao = ORDEM_ESTADO.indexOf(ESTADO_PARA_DOMINIO[evento.estadoNovo]);
          if (posicao < 0) continue;
          observacoes.push({ x: mesesEntre(equipamento.lote.dataEntrada, evento.timestamp), y: posicao });
        }
        eventosPorTipo.set(equipamento.tipo, observacoes);
      }

      for (const tipo of Object.values(TipoEquipamento)) {
        const falhas = falhasPorTipo.get(tipo) ?? new Set<string>();
        const ids = idsPorTipo.get(tipo) ?? new Set<string>();
        const emUso = ids.size - falhas.size;
        const observacoes = eventosPorTipo.get(tipo) ?? [];
        metricas.push({ metrica: 'VIDA_UTIL_AMOSTRAS', chave: `tipo=${tipo};falhas`, valor: falhas.size, amostras: falhas.size });
        metricas.push({ metrica: 'VIDA_UTIL_AMOSTRAS', chave: `tipo=${tipo};emUso`, valor: emUso, amostras: emUso });
        if (falhas.size < 5 || observacoes.length < 2) {
          previsoesPorTipo.push({
            tipoEquipamento: tipo,
            status: 'DADOS_INSUFICIENTES',
            falhas: falhas.size,
            emUso,
            motivo: 'São necessárias pelo menos cinco falhas observadas e duas observações físicas.',
          });
          continue;
        }
        const resultado = calcularOlsVidaUtil(observacoes);
        if (resultado.motivoInvalido) {
          previsoesPorTipo.push({
            tipoEquipamento: tipo,
            status: 'MODELO_INVALIDO',
            falhas: falhas.size,
            emUso,
            motivo: resultado.motivoInvalido,
          });
          continue;
        }
        const id = randomUUID();
        const parametros = {
          inclinacao: resultado.inclinacao,
          intercepto: resultado.intercepto,
          falhas: falhas.size,
          emUso,
        };
        previsoes.push({
          id,
          tipoEquipamento: tipo,
          dataPrevisao: dataReferencia,
          metodologia: 'REGRESSAO_OLS',
          vidaUtilEstimadaMeses: resultado.vidaPrevistaMeses,
          r2: resultado.r2,
          amostras: observacoes.length,
          parametros,
        });
        previsoesPorTipo.push({ tipoEquipamento: tipo, status: 'PREVISAO_PUBLICADA', falhas: falhas.size, emUso });
        for (const equipamento of equipamentos.filter((item) => item.tipo === tipo)) {
          const eventosAtuais = eventosFisicosPorEquipamento.get(equipamento.id) ?? [];
          const estadoAtual = eventosAtuais.at(-1)?.estadoNovo;
          if (!estadoAtual || estadoAtual === PrismaEstadoFisico.INSERVIVEL) continue;
          const idadeAtualMeses = mesesEntre(equipamento.lote.dataEntrada, dataReferencia);
          const vidaRestanteMeses = resultado.vidaPrevistaMeses - idadeAtualMeses;
          vidaRestantePorEquipamento.push({
            tipo,
            equipamentoId: equipamento.id,
            idadeAtualMeses,
            vidaRestanteMeses,
            idadeExcedeuEstimativa: vidaRestanteMeses < 0,
          });
          metricas.push({
            metrica: 'VIDA_UTIL_RESTANTE_MESES',
            chave: `tipo=${tipo};equipamento=${equipamento.id}`,
            valor: vidaRestanteMeses,
            amostras: 1,
          });
        }
        metricas.push({ metrica: 'VIDA_UTIL_INCLINACAO', chave: `tipo=${tipo}`, valor: resultado.inclinacao, amostras: observacoes.length });
        metricas.push({ metrica: 'VIDA_UTIL_INTERCEPTO', chave: `tipo=${tipo}`, valor: resultado.intercepto, amostras: observacoes.length });
        if (resultado.r2 !== null) metricas.push({ metrica: 'VIDA_UTIL_R2', chave: `tipo=${tipo}`, valor: resultado.r2, amostras: observacoes.length });
        metricas.push({ metrica: 'VIDA_UTIL_PREVISTA_MESES', chave: `tipo=${tipo}`, valor: resultado.vidaPrevistaMeses, amostras: observacoes.length });
      }

      const execucao = await tx.execucaoAnalise.create({
        data: {
          id: randomUUID(),
          tipoRelatorio: 'COMPLETO',
          parametros: { agrupamentos: ['mes', 'responsavel'], dataReferencia: dataReferencia.toISOString() },
          versaoCalculo: VERSAO_CALCULO,
          dataReferencia,
        },
      });

      const metricasUnicas = new Map<string, ResultadoMetricas>();
      for (const metrica of metricas) {
        const chave = metrica.chave ?? '';
        metricasUnicas.set(`${metrica.metrica}:${chave}`, metrica);
      }
      const resultados = [...metricasUnicas.values()];
      if (resultados.length) {
        await tx.resultadoAnalise.createMany({
          data: resultados.map((item) => ({
            id: randomUUID(),
            execucaoId: execucao.id,
          metrica: item.metrica,
            chave: item.chave ?? '',
            valor: item.valor,
            amostras: item.amostras,
          })),
        });
      }
      if (previsoes.length) {
        await tx.previsaoVidaUtil.createMany({
          data: previsoes.map((item) => ({
            ...item,
            execucaoAnaliseId: execucao.id,
            solicitacaoRelatorioId: solicitacaoRelatorioId ?? null,
            parametros: item.parametros,
          })),
        });
      }

      const falhasPorEquipamento = new Map<string, (typeof historicoFisico)[number]>();
      for (const evento of historicoFisico) {
        if (evento.estadoNovo === PrismaEstadoFisico.INSERVIVEL && !falhasPorEquipamento.has(evento.equipamentoId)) {
          falhasPorEquipamento.set(evento.equipamentoId, evento);
        }
      }
      const falhas = [...falhasPorEquipamento.values()];
      const previsoesAnteriores = await tx.previsaoVidaUtil.findMany({
        where: { dataPrevisao: { lt: dataReferencia } },
      });
      const validacoes = [];
      for (const previsao of previsoesAnteriores) {
        for (const evento of falhas) {
          const equipamento = equipamentoPorId.get(evento.equipamentoId);
          if (
            !equipamento ||
            equipamento.tipo !== previsao.tipoEquipamento ||
            evento.timestamp <= previsao.dataPrevisao
          ) continue;
          const idadeRealMeses = mesesEntre(equipamento.lote.dataEntrada, evento.timestamp);
          validacoes.push({
            id: randomUUID(),
            previsaoId: previsao.id,
            equipamentoId: equipamento.id,
            idadeRealMeses,
            erroAbsolutoMeses: Math.abs(idadeRealMeses - Number(previsao.vidaUtilEstimadaMeses)),
          });
        }
      }
      if (validacoes.length) {
        await tx.validacaoPrevisao.createMany({ data: validacoes, skipDuplicates: true });
      }

      const resultadoCompleto = {
        execucaoId: execucao.id,
        tipoRelatorio: execucao.tipoRelatorio,
        versaoCalculo: execucao.versaoCalculo,
        dataReferencia: execucao.dataReferencia,
        eficiencia: {
          lotesConcluidos: duracoes.length,
          lotesPendentes: lotes.length - duracoes.length,
          tempoMedioHoras: eficiencia.mediaHoras,
          agrupamentos: [...gruposEficiencia.entries()].map(([chave, valores]) => ({
            chave,
            amostras: valores.length,
            tempoMedioHoras: valores.reduce((soma, valor) => soma + valor, 0) / valores.length,
          })),
        },
        recuperacaoBruta: {
          amostras: amostrasRecuperacao.length,
          dadosDemonstracao: amostrasRecuperacao.some((item) => item.referenciaComprovante?.startsWith('DEMO-SEED:')),
          porTipo: [...valoresPorTipo.entries()].map(([tipo, valores]) => ({
            tipo,
            media: valores.reduce((soma, valor) => soma + valor, 0) / valores.length,
            amostras: valores.length,
          })),
        },
        previsoes: previsoes.map((item) => ({
          id: item.id,
          tipoEquipamento: item.tipoEquipamento,
          vidaUtilEstimadaMeses: item.vidaUtilEstimadaMeses,
          r2: item.r2,
          amostras: item.amostras,
          falhas: item.parametros.falhas,
          emUso: item.parametros.emUso,
        })),
        previsoesPorTipo,
        vidaRestantePorEquipamento,
        resultadosPersistidos: resultados.length,
      };
      if (solicitacaoRelatorioId) {
        await tx.solicitacaoRelatorio.update({
          where: { id: solicitacaoRelatorioId },
          data: { resultado: JSON.parse(JSON.stringify(resultadoCompleto)) },
        });
      }
      return resultadoCompleto;
    }, { timeout: 30_000 });
  }

  async buscarExecucao(id: string) {
    return prisma.execucaoAnalise.findUnique({
      where: { id },
      include: { resultados: { orderBy: [{ metrica: 'asc' }, { chave: 'asc' }] }, previsoes: true },
    });
  }
}
