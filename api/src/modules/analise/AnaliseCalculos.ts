import { EstadoFisico } from '@domain/enums/EstadoFisico.js';
import { ORDEM_ESTADO } from '@domain/entities/Equipamento.js';
import { StatusLote } from '@domain/enums/StatusLote.js';

const MS_POR_MES = 1000 * 60 * 60 * 24 * 365.2425 / 12;

export function mesesEntre(inicio: Date, fim: Date): number {
  return (fim.getTime() - inicio.getTime()) / MS_POR_MES;
}

export type EventoStatusLote = {
  loteId: string;
  statusAnterior: string | null;
  statusNovo: string;
  timestamp: Date;
  responsavelId: string | null;
};

export type LoteParaEficiencia = { id: string };

export function calcularEficienciaLotes(
  lotes: readonly LoteParaEficiencia[],
  eventos: readonly EventoStatusLote[],
) {
  const porLote = new Map<string, EventoStatusLote[]>();
  for (const evento of eventos) {
    const lista = porLote.get(evento.loteId) ?? [];
    lista.push(evento);
    porLote.set(evento.loteId, lista);
  }
  const duracoes = [] as {
    loteId: string;
    horas: number;
    conclusao: Date;
    responsavelId: string | null;
  }[];
  for (const lote of lotes) {
    const historico = porLote.get(lote.id) ?? [];
    const recebido = historico.find(
      (evento) => evento.statusAnterior === null && evento.statusNovo === StatusLote.RECEBIDO,
    );
    const conclusao = historico.find((evento) => evento.statusNovo === StatusLote.TRIAGEM_CONCLUIDA);
    if (!recebido || !conclusao || conclusao.timestamp < recebido.timestamp) continue;
    duracoes.push({
      loteId: lote.id,
      horas: (conclusao.timestamp.getTime() - recebido.timestamp.getTime()) / 3_600_000,
      conclusao: conclusao.timestamp,
      responsavelId: conclusao.responsavelId,
    });
  }
  return {
    concluidos: duracoes,
    pendentes: lotes.length - duracoes.length,
    mediaHoras: duracoes.length
      ? duracoes.reduce((soma, item) => soma + item.horas, 0) / duracoes.length
      : null,
  };
}

export type ObservacaoRegressao = { x: number; y: number };

export type ResultadoOls = {
  inclinacao: number;
  intercepto: number;
  r2: number | null;
  vidaPrevistaMeses: number;
  motivoInvalido?: 'VARIANCIA_X_ZERO' | 'INCLINACAO_NAO_POSITIVA' | 'PREVISAO_FORA_INTERVALO';
};

export function calcularOlsVidaUtil(observacoes: readonly ObservacaoRegressao[]): ResultadoOls {
  const n = observacoes.length;
  const mediaX = observacoes.reduce((soma, ponto) => soma + ponto.x, 0) / n;
  const mediaY = observacoes.reduce((soma, ponto) => soma + ponto.y, 0) / n;
  const somaXX = observacoes.reduce((soma, ponto) => soma + (ponto.x - mediaX) ** 2, 0);
  const somaXY = observacoes.reduce(
    (soma, ponto) => soma + (ponto.x - mediaX) * (ponto.y - mediaY),
    0,
  );

  if (n < 2 || somaXX === 0) {
    return {
      inclinacao: 0,
      intercepto: mediaY,
      r2: null,
      vidaPrevistaMeses: 0,
      motivoInvalido: 'VARIANCIA_X_ZERO',
    };
  }

  const inclinacao = somaXY / somaXX;
  const intercepto = mediaY - inclinacao * mediaX;
  const somaYY = observacoes.reduce((soma, ponto) => soma + (ponto.y - mediaY) ** 2, 0);
  const somaErro = observacoes.reduce(
    (soma, ponto) => soma + (ponto.y - (intercepto + inclinacao * ponto.x)) ** 2,
    0,
  );
  const r2 = somaYY === 0 ? null : 1 - somaErro / somaYY;

  if (inclinacao <= 0) {
    return {
      inclinacao,
      intercepto,
      r2,
      vidaPrevistaMeses: 0,
      motivoInvalido: 'INCLINACAO_NAO_POSITIVA',
    };
  }

  const vidaPrevistaMeses = (ORDEM_ESTADO.indexOf(EstadoFisico.INSERVIVEL) - intercepto) / inclinacao;
  if (!Number.isFinite(vidaPrevistaMeses) || vidaPrevistaMeses <= 0 || vidaPrevistaMeses > 1200) {
    return {
      inclinacao,
      intercepto,
      r2,
      vidaPrevistaMeses,
      motivoInvalido: 'PREVISAO_FORA_INTERVALO',
    };
  }

  return { inclinacao, intercepto, r2, vidaPrevistaMeses };
}

export type AmostraRecuperacao = {
  id: string;
  tipo: string;
  estado: EstadoFisico;
  marca: string;
  modelo: string;
  valor: number;
  dataRealizacao: Date;
  referenciaComprovante: string | null;
};

export type ChaveEstimativa = Pick<AmostraRecuperacao, 'tipo' | 'estado' | 'marca' | 'modelo'>;

export function estimarRecuperacao(
  chave: ChaveEstimativa,
  amostras: readonly AmostraRecuperacao[],
): { valor: number; quantidadeAmostras: number; nivel: 'COMPLETO' | 'TIPO_ESTADO' } | null {
  const validas = amostras.filter(
    (amostra) =>
      Number.isFinite(amostra.valor) &&
      amostra.valor >= 0 &&
      amostra.dataRealizacao instanceof Date &&
      Number.isFinite(amostra.dataRealizacao.getTime()),
  );
  const completas = validas.filter(
    (amostra) =>
      amostra.tipo === chave.tipo &&
      amostra.estado === chave.estado &&
      amostra.marca.toLocaleLowerCase() === chave.marca.toLocaleLowerCase() &&
      amostra.modelo.toLocaleLowerCase() === chave.modelo.toLocaleLowerCase(),
  );
  const usadas = completas.length
    ? completas
    : validas.filter((amostra) => amostra.tipo === chave.tipo && amostra.estado === chave.estado);
  if (usadas.length === 0) return null;
  return {
    valor: usadas.reduce((soma, amostra) => soma + amostra.valor, 0) / usadas.length,
    quantidadeAmostras: usadas.length,
    nivel: completas.length ? 'COMPLETO' : 'TIPO_ESTADO',
  };
}
