import type { StatusLote } from '@domain/enums/StatusLote.js';

export type NovaTransicaoStatusLote = {
  loteId: string;
  statusAnterior: StatusLote | null;
  statusNovo: StatusLote;
  responsavelId: string | null;
};

export interface HistoricoStatusLoteRepository {
  registrarTransicao(transicao: NovaTransicaoStatusLote): Promise<void>;
}
