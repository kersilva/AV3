import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';

process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:55433/greencode_test';
process.env.JWT_SECRET ??= 'integration-test-secret-with-at-least-32-bytes';

const [{ compositionRoot }, { registrarErrorHandler }] = await Promise.all([
  import('../src/infrastructure/compositionRoot.js'),
  import('../src/infrastructure/errorHandler.js'),
]);

test('rotas internas versionadas e aliases usam JWT; rotas públicas usam chave de parceiro', async (context) => {
  const app = Fastify({ logger: false });
  registrarErrorHandler(app);
  await app.register(fastifyJwt, { secret: process.env.JWT_SECRET! });
  await compositionRoot(app);
  await app.ready();
  context.after(() => app.close());

  const interna = await app.inject({ method: 'GET', url: '/api/v1/internal/relatorios/financeiro' });
  assert.equal(interna.statusCode, 401);
  assert.equal(interna.headers.deprecation, undefined);

  const gestaoInterna = await app.inject({
    method: 'POST',
    url: '/api/v1/internal/parceiros-api',
    payload: { nome: 'Parceiro teste', emailContato: 'teste@example.test', organizacaoId: 'org-teste' },
  });
  assert.equal(gestaoInterna.statusCode, 401);

  const alias = await app.inject({ method: 'GET', url: '/relatorios/financeiro' });
  assert.equal(alias.statusCode, 401);
  assert.equal(alias.headers.deprecation, 'true');
  assert.equal(alias.headers.link, '</api/v1/internal/relatorios/financeiro>; rel="successor-version"');

  const parceiroSemChave = await app.inject({
    method: 'GET',
    url: '/api/v1/public/equipamentos/inexistente/rastreabilidade',
    headers: { authorization: 'Bearer token-de-usuario' },
  });
  assert.equal(parceiroSemChave.statusCode, 401);

  const rotaAntigaParceiro = await app.inject({ method: 'GET', url: '/parceiros-api' });
  assert.equal(rotaAntigaParceiro.statusCode, 401);
  assert.equal(rotaAntigaParceiro.headers.deprecation, 'true');
});
