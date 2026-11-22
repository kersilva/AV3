import type { EstadoFisico } from '@domain/enums/EstadoFisico.js';

export type NovaTransicaoEstadoFisico = {
  equipamentoId: string;
  estadoAnterior: EstadoFisico | null;
  estadoNovo: EstadoFisico;
  justificativa: string | null;
  responsavelId: string | null;
};

export interface HistoricoEstadoFisicoRepository {
  registrarTransicao(transicao: NovaTransicaoEstadoFisico): Promise<void>;
}
