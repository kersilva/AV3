import assert from 'node:assert/strict';
import test from 'node:test';
import { EstadoFisico } from '../src/domain/enums/EstadoFisico.js';
import { calcularEficienciaLotes, calcularOlsVidaUtil, estimarRecuperacao } from '../src/modules/analise/AnaliseCalculos.js';

test('eficiência usa os eventos do próprio lote e a primeira conclusão', () => {
  const inicioA = new Date('2025-01-01T00:00:00Z');
  const fimA = new Date('2025-01-01T10:00:00Z');
  const inicioB = new Date('2025-01-02T00:00:00Z');
  const fimB = new Date('2025-01-02T20:00:00Z');
  const resultado = calcularEficienciaLotes(
    [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    [
      { loteId: 'a', statusAnterior: null, statusNovo: 'RECEBIDO', timestamp: inicioA, responsavelId: null },
      { loteId: 'a', statusAnterior: 'EM_TRIAGEM', statusNovo: 'TRIAGEM_CONCLUIDA', timestamp: fimA, responsavelId: 'u1' },
      { loteId: 'a', statusAnterior: 'EM_TRIAGEM', statusNovo: 'TRIAGEM_CONCLUIDA', timestamp: new Date('2025-01-01T12:00:00Z'), responsavelId: 'u1' },
      { loteId: 'b', statusAnterior: null, statusNovo: 'RECEBIDO', timestamp: inicioB, responsavelId: null },
      { loteId: 'b', statusAnterior: 'EM_TRIAGEM', statusNovo: 'TRIAGEM_CONCLUIDA', timestamp: fimB, responsavelId: 'u2' },
    ],
  );
  assert.equal(resultado.concluidos.length, 2);
  assert.equal(resultado.concluidos[0]?.horas, 10);
  assert.equal(resultado.concluidos[1]?.horas, 20);
  assert.equal(resultado.mediaHoras, 15);
  assert.equal(resultado.pendentes, 1);
});

test('OLS recupera a idade-alvo para pontos em uma reta conhecida', () => {
  const resultado = calcularOlsVidaUtil([
    { x: 0, y: 0 },
    { x: 10, y: 1 },
    { x: 20, y: 2 },
    { x: 30, y: 3 },
    { x: 40, y: 4 },
    { x: 50, y: 5 },
    { x: 60, y: 6 },
  ]);
  assert.equal(resultado.motivoInvalido, undefined);
  assert.equal(resultado.vidaPrevistaMeses, 60);
  assert.equal(resultado.r2, 1);
});

test('OLS informa variância zero e inclinação negativa como inválidas', () => {
  assert.equal(calcularOlsVidaUtil([{ x: 2, y: 1 }, { x: 2, y: 4 }]).motivoInvalido, 'VARIANCIA_X_ZERO');
  assert.equal(calcularOlsVidaUtil([{ x: 0, y: 6 }, { x: 1, y: 5 }]).motivoInvalido, 'INCLINACAO_NAO_POSITIVA');
});

test('estimativa usa correspondência completa e faz fallback por tipo e estado', () => {
  const amostras = [
    { id: 'a', tipo: 'NOTEBOOK', estado: EstadoFisico.BOM_ESTADO, marca: 'A', modelo: 'X', valor: 10, dataRealizacao: new Date('2025-01-01'), referenciaComprovante: 'NF-A' },
    { id: 'b', tipo: 'NOTEBOOK', estado: EstadoFisico.BOM_ESTADO, marca: 'B', modelo: 'Y', valor: 30, dataRealizacao: new Date('2025-01-01'), referenciaComprovante: 'NF-B' },
  ];
  const completa = estimarRecuperacao({ tipo: 'NOTEBOOK', estado: EstadoFisico.BOM_ESTADO, marca: 'a', modelo: 'x' }, amostras);
  assert.deepEqual(completa, { valor: 10, quantidadeAmostras: 1, nivel: 'COMPLETO' });
  const fallback = estimarRecuperacao({ tipo: 'NOTEBOOK', estado: EstadoFisico.BOM_ESTADO, marca: 'C', modelo: 'Z' }, amostras);
  assert.deepEqual(fallback, { valor: 20, quantidadeAmostras: 2, nivel: 'TIPO_ESTADO' });
});
