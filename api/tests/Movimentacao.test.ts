import assert from 'node:assert/strict';
import test from 'node:test';
import { Movimentacao } from '../src/domain/entities/Movimentacao.js';
import { StatusRastreamento } from '../src/domain/enums/StatusRastreamento.js';
import { ErroValidacao } from '../src/shared/errors/DomainError.js';

test('Movimentacao.criar lança ErroValidacao quando origem e destino são iguais', () => {
  assert.throws(
    () =>
      Movimentacao.criar({
        id: 'movimentacao-teste',
        equipamentoId: 'equipamento-teste',
        dataHora: new Date('2025-01-01T00:00:00.000Z'),
        origem: StatusRastreamento.AGUARDANDO_TRIAGEM,
        destino: StatusRastreamento.AGUARDANDO_TRIAGEM,
        responsavelId: null,
        observacao: null,
      }),
    ErroValidacao,
  );
});
