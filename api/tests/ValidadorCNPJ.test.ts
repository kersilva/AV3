import assert from 'node:assert/strict';
import test from 'node:test';
import { ValidadorCNPJ } from '../src/domain/validators/ValidadorCNPJ.js';

test('ValidadorCNPJ aceita CNPJ válido e recusa dígito verificador incorreto', () => {
  const validador = new ValidadorCNPJ();

  assert.equal(validador.validar('11.222.333/0001-81'), true);
  assert.equal(validador.validar('11.222.333/0001-80'), false);
});
