import assert from "node:assert/strict";
import { test } from "vitest";
import { StatusLote } from "../src/generated/prisma/enums.js";
import {
  dataSeed,
  datasHistoricoEstadoFisico,
  datasHistoricoLote,
  datasMovimentacoes,
  inicioHistoricoLote,
} from "../prisma/seed-data.js";

function intervalosEmDias(datas: readonly Date[]): number[] {
  return datas.slice(1).map((data, indice) => {
    const anterior = datas[indice];
    assert.ok(anterior);
    return (data.getTime() - anterior.getTime()) / (24 * 60 * 60 * 1000);
  });
}

test("datas dos status de lote têm intervalos e ordem estáveis", () => {
  const linhas = [
    { statusAnterior: null, statusNovo: StatusLote.RECEBIDO },
    { statusAnterior: StatusLote.RECEBIDO, statusNovo: StatusLote.EM_TRIAGEM },
    { statusAnterior: StatusLote.EM_TRIAGEM, statusNovo: StatusLote.TRIAGEM_CONCLUIDA },
    { statusAnterior: StatusLote.TRIAGEM_CONCLUIDA, statusNovo: StatusLote.ENCAMINHADO },
    { statusAnterior: StatusLote.ENCAMINHADO, statusNovo: StatusLote.FINALIZADO },
  ];
  const primeiraExecucao = datasHistoricoLote(inicioHistoricoLote(4), linhas);
  const segundaExecucao = datasHistoricoLote(inicioHistoricoLote(4), linhas);

  assert.deepEqual(primeiraExecucao, segundaExecucao);
  assert.deepEqual(intervalosEmDias(primeiraExecucao), [4, 5, 6, 9]);
});

test("lotes em etapas diferentes começam em datas diferentes", () => {
  const dataRecebido = dataSeed(inicioHistoricoLote(0));
  const dataTriagemConcluida = dataSeed(inicioHistoricoLote(2));

  assert.notEqual(dataRecebido.toISOString(), dataTriagemConcluida.toISOString());
  assert.equal((dataTriagemConcluida.getTime() - dataRecebido.getTime()) / (24 * 60 * 60 * 1000), 90);
});

test("mudanças de estado físico ficam espaçadas em 30 dias", () => {
  const datas = datasHistoricoEstadoFisico(120, 3);

  assert.deepEqual(intervalosEmDias(datas), [30, 30]);
  assert.deepEqual(datas, datasHistoricoEstadoFisico(120, 3));
});

test("movimentações ficam depois do histórico físico e espaçadas em 3 dias", () => {
  const fisicas = datasHistoricoEstadoFisico(90, 2);
  const movimentacoes = datasMovimentacoes(90, 3);

  assert.ok(movimentacoes[0]);
  assert.ok(fisicas.at(-1));
  assert.ok(movimentacoes[0].getTime() > fisicas.at(-1)!.getTime());
  assert.deepEqual(intervalosEmDias(movimentacoes), [3, 3]);
  assert.deepEqual(movimentacoes, datasMovimentacoes(90, 3));
});
