import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { prisma } from '../../src/infrastructure/database.js';
import { compositionRoot } from '../../src/infrastructure/compositionRoot.js';
import { registrarErrorHandler } from '../../src/infrastructure/errorHandler.js';
import { criarParceiroFixture, criarSolicitacaoConcluida } from './support.js';

test('status e download pertencem ao parceiro criador e servem JSON concluído', async (context) => {
  const dono = await criarParceiroFixture(context, 'Parceiro dono relatório');
  const outro = await criarParceiroFixture(context, 'Outro parceiro');
  const app = Fastify({ logger: false });
  registrarErrorHandler(app);
  await app.register(fastifyJwt, { secret: process.env.JWT_SECRET! });
  await compositionRoot(app);
  await app.ready();
  context.after(() => app.close());

  const id = await criarSolicitacaoConcluida(dono);
  const payloadEsperado = { execucaoId: 'execucao-de-teste', tipoRelatorio: 'COMPLETO', indicadores: { total: 4 } };
  await writeFile(path.join(process.env.REPORTS_DIR!, `${id}.json`), JSON.stringify(payloadEsperado), 'utf8');

  const statusDono = await app.inject({
    method: 'GET', url: `/api/v1/public/relatorios/${id}`,
    headers: { 'x-api-key': dono.apiKey },
  });
  assert.equal(statusDono.statusCode, 200);
  const statusJson = statusDono.json();
  assert.equal(statusJson.id, id);
  assert.equal(statusJson.status, 'CONCLUIDO');
  assert.equal(statusJson.tentativas, 1);
  assert.equal(statusJson.duracaoProcessamentoMs, 125);

  const statusOutro = await app.inject({
    method: 'GET', url: `/api/v1/public/relatorios/${id}`,
    headers: { 'x-api-key': outro.apiKey },
  });
  assert.equal(statusOutro.statusCode, 404);

  await prisma.solicitacaoRelatorio.update({ where: { id }, data: { status: 'PENDENTE' } });
  const downloadPendente = await app.inject({
    method: 'GET', url: `/api/v1/public/relatorios/${id}/download`,
    headers: { 'x-api-key': dono.apiKey },
  });
  assert.equal(downloadPendente.statusCode, 404);
  await prisma.solicitacaoRelatorio.update({ where: { id }, data: { status: 'CONCLUIDO' } });

  const downloadDono = await app.inject({
    method: 'GET', url: `/api/v1/public/relatorios/${id}/download`,
    headers: { 'x-api-key': dono.apiKey },
  });
  assert.equal(downloadDono.statusCode, 200);
  assert.match(downloadDono.headers['content-type'] ?? '', /application\/json/);
  assert.deepEqual(JSON.parse(downloadDono.body), payloadEsperado);

  const downloadOutro = await app.inject({
    method: 'GET', url: `/api/v1/public/relatorios/${id}/download`,
    headers: { 'x-api-key': outro.apiKey },
  });
  assert.equal(downloadOutro.statusCode, 404);
});
