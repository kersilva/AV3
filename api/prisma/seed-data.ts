import { StatusLote } from "../src/generated/prisma/enums.js";

const DURACAO_DIAS = 24 * 60 * 60 * 1000;

const DATAS_STATUS_LOTE_DIAS: Record<StatusLote, number> = {
  [StatusLote.RECEBIDO]: 0,
  [StatusLote.EM_TRIAGEM]: 3,
  [StatusLote.TRIAGEM_CONCLUIDA]: 7,
  [StatusLote.ENCAMINHADO]: 12,
  [StatusLote.FINALIZADO]: 20,
};

export function dataSeed(diasDesdeInicio: number): Date {
  return new Date(Date.UTC(2025, 0, 1) + diasDesdeInicio * DURACAO_DIAS);
}

export function inicioHistoricoLote(indiceStatusDesejado: number): number {
  return indiceStatusDesejado * 45;
}

export function datasHistoricoLote(
  inicio: number,
  linhas: readonly { statusAnterior: StatusLote | null; statusNovo: StatusLote }[],
): Date[] {
  return linhas.map((linha, indice) => {
    const dias = linha.statusAnterior === null
      ? 0
      : DATAS_STATUS_LOTE_DIAS[linha.statusNovo];
    return dataSeed(inicio + dias + indice);
  });
}

export function datasHistoricoEstadoFisico(inicio: number, quantidade: number): Date[] {
  return Array.from({ length: quantidade }, (_, indice) => dataSeed(inicio + indice * 30));
}

export function datasMovimentacoes(inicio: number, quantidade: number): Date[] {
  return Array.from({ length: quantidade }, (_, indice) =>
    dataSeed(inicio + 60 + indice * 3),
  );
}
