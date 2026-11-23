import assert from 'node:assert/strict';
import test from 'node:test';
import { criarParceiroFixture, criarSolicitacaoConcluida, iniciarApi, portaDisponivel } from './support.js';

test('reiniciar o processo HTTP mantém consultas de relatório persistidas', { timeout: 45_000 }, async (context) => {
  const fixture = await criarParceiroFixture(context, 'Parceiro restart API');
  const id = await criarSolicitacaoConcluida(fixture);
  const porta = await portaDisponivel();
  const servidores: Awaited<ReturnType<typeof iniciarApi>>[] = [];
  context.after(async () => {
    await Promise.all(servidores.map((servidor) => servidor.aguardarParada().catch(() => undefined)));
  });

  const primeiro = await iniciarApi(porta);
  servidores.push(primeiro);
  const urlStatus = `http://127.0.0.1:${porta}/api/v1/public/relatorios/${id}`;
  const antesDoRestart = await fetch(urlStatus, { headers: { 'x-api-key': fixture.apiKey } });
  assert.equal(antesDoRestart.status, 200);
  assert.equal((await antesDoRestart.json() as { id: string }).id, id);

  await primeiro.aguardarParada();
  const segundo = await iniciarApi(porta);
  servidores.push(segundo);
  const depoisDoRestart = await fetch(urlStatus, { headers: { 'x-api-key': fixture.apiKey } });
  assert.equal(depoisDoRestart.status, 200);
  const statusPersistido = await depoisDoRestart.json() as { id: string; status: string; tentativas: number };
  assert.equal(statusPersistido.id, id);
  assert.equal(statusPersistido.status, 'CONCLUIDO');
  assert.equal(statusPersistido.tentativas, 1);

  const inexistente = await fetch(`http://127.0.0.1:${porta}/api/v1/public/relatorios/${id}`, {
    headers: { 'x-api-key': `gc_live_${'x'.repeat(40)}` },
  });
  assert.equal(inexistente.status, 401);
});
