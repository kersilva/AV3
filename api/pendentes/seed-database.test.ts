import "dotenv/config";
import assert from "node:assert/strict";
import { test } from "vitest";
import { StatusLote } from "../src/generated/prisma/enums.js";
import { StatusRastreamento } from "../src/generated/prisma/enums.js";
import {
  dataSeed,
  datasHistoricoEstadoFisico,
  datasHistoricoLote,
  datasMovimentacoes,
  inicioHistoricoLote,
} from "../prisma/seed-data.js";

const executarVerificacaoBanco = process.env.RUN_SEED_DB_TESTS === "1";

test("dados seed no banco seguem datas estáveis após executar o seed", {
  skip: !executarVerificacaoBanco,
}, async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("Defina DATABASE_URL para verificar os dados do seed.");
  }

  const { prisma } = await import("../src/infrastructure/database.js");
  try {
    const lotes = await prisma.lote.findMany({
      where: { id: { startsWith: "seed-lote-" } },
      include: { historicoStatus: { orderBy: { timestamp: "asc" } } },
    });
    assert.equal(lotes.length, Object.values(StatusLote).length);

    for (const lote of lotes) {
      const indiceStatus = Object.values(StatusLote).indexOf(lote.statusProcessamento);
      assert.ok(indiceStatus >= 0);
      const inicio = inicioHistoricoLote(indiceStatus);
      assert.equal(lote.dataEntrada.getTime(), dataSeed(inicio).getTime());
      assert.deepEqual(
        lote.historicoStatus.map((linha) => linha.statusNovo),
        Object.values(StatusLote).slice(0, indiceStatus + 1),
      );
      const datasEsperadas = datasHistoricoLote(inicio, lote.historicoStatus);
      assert.deepEqual(
        lote.historicoStatus.map((linha) => linha.timestamp.getTime()),
        datasEsperadas.map((data) => data.getTime()),
      );
    }

    const equipamentos = await prisma.equipamento.findMany({
      where: { id: { startsWith: "seed-equipamento-" } },
      include: {
        historicoEstadoFisico: { orderBy: { timestamp: "asc" } },
        historicoMovimentacao: { orderBy: { dataHora: "asc" } },
      },
    });
    assert.equal(equipamentos.length, 8);

    for (const equipamento of equipamentos) {
      const inicio = equipamento.posicaoNoLote * 30;
      const datasFisicas = datasHistoricoEstadoFisico(
        inicio,
        equipamento.historicoEstadoFisico.length,
      );
      assert.ok(equipamento.historicoEstadoFisico.length > 0);
      assert.deepEqual(
        equipamento.historicoEstadoFisico.map((linha) => linha.timestamp.getTime()),
        datasFisicas.map((data) => data.getTime()),
      );

      const ordemStatus = [
        StatusRastreamento.AGUARDANDO_TRIAGEM,
        StatusRastreamento.EM_TRIAGEM,
        StatusRastreamento.AGUARDANDO_DESMONTE,
        StatusRastreamento.EM_DESMONTE,
        StatusRastreamento.PECAS_REAPROVEITADAS,
        StatusRastreamento.MATERIAL_RECICLAVEL,
        StatusRastreamento.DESCARTE_SEGURO,
        StatusRastreamento.BAIXA_DEFINITIVA,
      ];
      const indiceStatus = ordemStatus.indexOf(equipamento.statusRastreamento);
      assert.ok(indiceStatus >= 0);
      assert.equal(equipamento.historicoMovimentacao.length, indiceStatus);
      assert.deepEqual(
        equipamento.historicoMovimentacao.map((movimentacao) => movimentacao.destino),
        ordemStatus.slice(1, indiceStatus + 1),
      );
      const datasDeMovimentacao = datasMovimentacoes(
        inicio,
        equipamento.historicoMovimentacao.length,
      );
      assert.deepEqual(
        equipamento.historicoMovimentacao.map((movimentacao) => movimentacao.dataHora.getTime()),
        datasDeMovimentacao.map((data) => data.getTime()),
      );
    }

    const datasLotes = new Set(lotes.map((lote) => lote.dataEntrada.getTime()));
    const datasEquipamentos = new Set(
      equipamentos.flatMap((equipamento) =>
        equipamento.historicoEstadoFisico.map((linha) => linha.timestamp.getTime()),
      ),
    );
    assert.ok(datasLotes.size > 1, "Os lotes devem ter datas de entrada variadas.");
    assert.ok(datasEquipamentos.size > 1, "Os equipamentos devem ter datas variadas.");

  } finally {
    await prisma.$disconnect();
  }
});
