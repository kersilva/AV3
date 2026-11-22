import { randomUUID } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client.js';
import type { EstadoFisico as PrismaEstadoFisico } from '@/generated/prisma/enums.js';
import { EstadoFisico } from '@domain/enums/EstadoFisico.js';
import type {
  HistoricoEstadoFisicoRepository as IHistoricoEstadoFisicoRepository,
  NovaTransicaoEstadoFisico,
} from '@domain/repositories/HistoricoEstadoFisicoRepository.js';
import { prisma } from '@infra/database.js';

const ESTADO_PARA_PRISMA: Record<EstadoFisico, PrismaEstadoFisico> = {
  [EstadoFisico.NOVO]: 'NOVO',
  [EstadoFisico.BOM_ESTADO]: 'BOM_ESTADO',
  [EstadoFisico.USADO_LEVE]: 'USADO_LEVE',
  [EstadoFisico.USADO_MODERADO]: 'USADO_MODERADO',
  [EstadoFisico.DANIFICADO_LEVE]: 'DANIFICADO_LEVE',
  [EstadoFisico.DANIFICADO_GRAVE]: 'DANIFICADO_GRAVE',
  [EstadoFisico.INSERVIVEL]: 'INSERVIVEL',
};

export class PrismaHistoricoEstadoFisicoRepository implements IHistoricoEstadoFisicoRepository {
  constructor(
    private readonly db: Pick<Prisma.TransactionClient, 'historicoEstadoFisico'> = prisma
  ) {}

  async registrarTransicao(transicao: NovaTransicaoEstadoFisico): Promise<void> {
    await this.db.historicoEstadoFisico.create({
      data: {
        id: randomUUID(),
        equipamentoId: transicao.equipamentoId,
        estadoAnterior: transicao.estadoAnterior
          ? ESTADO_PARA_PRISMA[transicao.estadoAnterior]
          : null,
        estadoNovo: ESTADO_PARA_PRISMA[transicao.estadoNovo],
        justificativa: transicao.justificativa,
        responsavelId: transicao.responsavelId,
      },
    });
  }
}
