import { Prisma } from '@/generated/prisma/client.js';
import type { StatusRastreamento as StatusRastreamentoPrisma } from '@/generated/prisma/enums.js';
import { EstadoFisico } from '@domain/enums/EstadoFisico.js';
import { StatusRastreamento } from '@domain/enums/StatusRastreamento.js';
import { TipoEquipamento } from '@domain/enums/TipoEquipamento.js';
import { Equipamento } from '@domain/entities/Equipamento.js';
import type { EquipamentoPersistido } from '@domain/entities/Equipamento.js';
import { Movimentacao } from '@domain/entities/Movimentacao.js';
import type { EquipamentoRepository as IEquipamentoRepository } from '@domain/repositories/EquipamentoRepository.js';
import type { EstadoExclusao } from '@domain/repositories/SoftDeleteRepository.js';
import { prisma } from '@infra/database.js';

const STATUS_PARA_DOMINIO: Record<StatusRastreamentoPrisma, StatusRastreamento> = {
  AGUARDANDO_TRIAGEM: StatusRastreamento.AGUARDANDO_TRIAGEM,
  EM_TRIAGEM: StatusRastreamento.EM_TRIAGEM,
  AGUARDANDO_DESMONTE: StatusRastreamento.AGUARDANDO_DESMONTE,
  EM_DESMONTE: StatusRastreamento.EM_DESMONTE,
  PECAS_REAPROVEITADAS: StatusRastreamento.PECAS_REAPROVEITADAS,
  MATERIAL_RECICLAVEL: StatusRastreamento.MATERIAL_RECICLAVEL,
  DESCARTE_SEGURO: StatusRastreamento.DESCARTE_SEGURO,
  BAIXA_DEFINITIVA: StatusRastreamento.BAIXA_DEFINITIVA,
};

const equipamentoCompleto = {
  historicoMovimentacao: { orderBy: { dataHora: 'asc' } },
} as const;

type EquipamentoCompleto = Prisma.EquipamentoGetPayload<{
  include: typeof equipamentoCompleto;
}>;

// Linha de Movimentacao exatamente como o Prisma devolve.
type MovimentacaoRow = EquipamentoCompleto['historicoMovimentacao'][number];

function mapMovimentacao(row: MovimentacaoRow): Movimentacao {
  return Movimentacao.reconstituir({
    ...row,
    origem: STATUS_PARA_DOMINIO[row.origem],
    destino: STATUS_PARA_DOMINIO[row.destino],
  });
}

function mapEquipamento(row: EquipamentoCompleto): Equipamento {
  const data: EquipamentoPersistido = {
    id: row.id,
    codigoBarrasInterno: row.codigoBarrasInterno,
    tipo: row.tipo as TipoEquipamento,
    marca: row.marca,
    modelo: row.modelo,
    anoFabricacao: row.anoFabricacao,
    estadoFisico: row.estadoFisico as EstadoFisico,
    pesoQuilogramas: Number(row.pesoQuilogramas),
    loteId: row.loteId,
    posicaoNoLote: row.posicaoNoLote,
    statusRastreamento: STATUS_PARA_DOMINIO[row.statusRastreamento],
    versao: row.versao,
  };
  return Equipamento.reconstituir(data, row.historicoMovimentacao.map(mapMovimentacao));
}

export class PrismaEquipamentoRepository implements IEquipamentoRepository {
  constructor(
    private readonly db: Pick<
      Prisma.TransactionClient,
      'equipamento' | 'movimentacao' | 'lote'
    > = prisma
  ) {}

  async buscarPorId(id: string): Promise<Equipamento | null> {
    const row = await this.db.equipamento.findFirst({
      where: { id, excluidoEm: null },
      include: equipamentoCompleto,
    });
    return row ? mapEquipamento(row) : null;
  }

  async listarMovimentacoes(equipamentoId: string): Promise<Movimentacao[]> {
    const rows = await this.db.movimentacao.findMany({
      where: { equipamentoId },
      orderBy: { dataHora: 'asc' },
    });
    return rows.map(mapMovimentacao);
  }

  async buscarPorIdIncluindoExcluido(id: string): Promise<Equipamento | null> {
    const row = await this.db.equipamento.findUnique({
      where: { id },
      include: equipamentoCompleto,
    });
    return row ? mapEquipamento(row) : null;
  }

  async listar(): Promise<Equipamento[]> {
    const rows = await this.db.equipamento.findMany({
      where: { excluidoEm: null },
      include: equipamentoCompleto,
      orderBy: [{ loteId: 'asc' }, { posicaoNoLote: 'asc' }],
    });
    return rows.map(mapEquipamento);
  }

  async criar(equipamento: Equipamento): Promise<Equipamento> {
    const dados = equipamento.toPrisma();
    const row = await this.db.equipamento.create({
      data: {
        id: dados.id,
        codigoBarrasInterno: dados.codigoBarrasInterno,
        tipo: dados.tipo,
        marca: dados.marca,
        modelo: dados.modelo,
        anoFabricacao: dados.anoFabricacao,
        estadoFisico: dados.estadoFisico,
        pesoQuilogramas: dados.pesoQuilogramas,
        loteId: dados.loteId,
        posicaoNoLote: dados.posicaoNoLote,
        statusRastreamento: dados.statusRastreamento,
        excluidoEm: null,
      },
      include: equipamentoCompleto,
    });
    return mapEquipamento(row);
  }

  async salvar(equipamento: Equipamento, versao: number): Promise<Equipamento | null> {
    const data = equipamento.toPrisma();
    const result = await this.db.equipamento.updateMany({
      where: { id: equipamento.id, versao, excluidoEm: null },
      data: {
        estadoFisico: data.estadoFisico,
        statusRastreamento: data.statusRastreamento,
        versao: { increment: 1 },
      },
    });
    return result.count ? this.buscarPorId(equipamento.id) : null;
  }

  async criarMovimentacao(movimentacao: Movimentacao): Promise<Movimentacao> {
    const data = movimentacao.toPrisma();
    const row = await this.db.movimentacao.create({
      data: data as Prisma.MovimentacaoUncheckedCreateInput,
    });
    return mapMovimentacao(row);
  }

  async obterEstadoExclusao(id: string): Promise<EstadoExclusao | null> {
    return this.db.equipamento.findUnique({
      where: { id },
      select: { id: true, excluidoEm: true, versao: true },
    });
  }

  async excluir(id: string, versao: number, data: Date): Promise<boolean> {
    const result = await this.db.equipamento.updateMany({
      where: { id, versao, excluidoEm: null },
      data: { excluidoEm: data, versao: { increment: 1 } },
    });
    return result.count > 0;
  }

  async reativar(id: string, versao: number): Promise<boolean> {
    const result = await this.db.equipamento.updateMany({
      where: { id, versao, excluidoEm: { not: null } },
      data: { excluidoEm: null, versao: { increment: 1 } },
    });
    return result.count > 0;
  }

  async loteAtivo(id: string): Promise<boolean> {
    return (await this.db.lote.count({ where: { id, excluidoEm: null } })) > 0;
  }

  contar(): Promise<number> {
    return this.db.equipamento.count({ where: { excluidoEm: null } });
  }
}