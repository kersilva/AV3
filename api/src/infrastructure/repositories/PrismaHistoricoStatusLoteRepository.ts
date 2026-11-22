import { randomUUID } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client.js';
import type { StatusLote as PrismaStatusLote } from '@/generated/prisma/enums.js';
import { StatusLote } from '@domain/enums/StatusLote.js';
import type {
  HistoricoStatusLoteRepository as IHistoricoStatusLoteRepository,
  NovaTransicaoStatusLote,
} from '@domain/repositories/HistoricoStatusLoteRepository.js';
import { prisma } from '@infra/database.js';

const STATUS_PARA_PRISMA: Record<StatusLote, PrismaStatusLote> = {
  [StatusLote.RECEBIDO]: 'RECEBIDO',
  [StatusLote.EM_TRIAGEM]: 'EM_TRIAGEM',
  [StatusLote.TRIAGEM_CONCLUIDA]: 'TRIAGEM_CONCLUIDA',
  [StatusLote.ENCAMINHADO]: 'ENCAMINHADO',
  [StatusLote.FINALIZADO]: 'FINALIZADO',
};

export class PrismaHistoricoStatusLoteRepository implements IHistoricoStatusLoteRepository {
  constructor(
    private readonly db: Pick<Prisma.TransactionClient, 'historicoStatusLote'> = prisma
  ) {}

  async registrarTransicao(transicao: NovaTransicaoStatusLote): Promise<void> {
    await this.db.historicoStatusLote.create({
      data: {
        id: randomUUID(),
        loteId: transicao.loteId,
        statusAnterior: transicao.statusAnterior
          ? STATUS_PARA_PRISMA[transicao.statusAnterior]
          : null,
        statusNovo: STATUS_PARA_PRISMA[transicao.statusNovo],
        responsavelId: transicao.responsavelId,
      },
    });
  }
}
