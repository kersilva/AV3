import assert from 'node:assert/strict';
import test from 'node:test';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { ErroConflito } from '../../src/shared/errors/DomainError.js';
import { prisma } from '../../src/infrastructure/database.js';
import { RelatorioApiService } from '../../src/modules/apiPublica/RelatorioApiService.js';
import { RelatorioQueueClient } from '../../src/modules/apiPublica/RelatorioQueue.js';
import { criarParceiroFixture } from './support.js';

test('solicitações simultâneas com a mesma chave criam uma solicitação e um job lógico', { timeout: 30_000 }, async (context) => {
  const fixture = await criarParceiroFixture(context, 'Parceiro idempotência');
  const redisUrl = process.env.REDIS_URL!;
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  redis.on('error', () => undefined);
  const fila = new Queue('greencode-relatorios', { connection: redis });
  const queueClient = new RelatorioQueueClient({ url: redisUrl, timeoutPublicacaoMs: 1_000 });
  const service = new RelatorioApiService(queueClient);
  const chave = 'chave-concorrente-onda-1';

  context.after(async () => {
    const rows = await prisma.solicitacaoRelatorio.findMany({
      where: { parceiroId: fixture.parceiroId, chaveIdempotencia: chave }, select: { id: true },
    }).catch(() => []);
    await Promise.all(rows.map(async ({ id }) => {
      const job = await fila.getJob(id).catch(() => null);
      await job?.remove().catch(() => undefined);
    }));
    await fila.close().catch(() => undefined);
    redis.disconnect();
    queueClient.desconectar();
  });

  const respostas = await Promise.all(Array.from({ length: 8 }, () => service.solicitar(
    fixture.contexto, {}, chave,
  )));
  const ids = new Set(respostas.map((resposta) => resposta.id));
  assert.equal(ids.size, 1);
  assert.equal(respostas.filter((resposta) => resposta.replayed).length, 7);

  const solicitacoes = await prisma.solicitacaoRelatorio.findMany({
    where: { parceiroId: fixture.parceiroId, chaveIdempotencia: chave },
  });
  assert.equal(solicitacoes.length, 1);
  const outboxes = await prisma.outboxRelatorio.findMany({ where: { solicitacaoId: respostas[0]!.id } });
  assert.equal(outboxes.length, 1);
  assert.equal(outboxes[0]!.status, 'PUBLICADO');

  const job = await fila.getJob(respostas[0]!.id);
  assert.ok(job);
  assert.equal(job.id, respostas[0]!.id);

  await assert.rejects(
    () => service.solicitar(fixture.contexto, { dataReferencia: '2025-01-01T00:00:00.000Z' }, chave),
    (erro: unknown) => erro instanceof ErroConflito,
  );
  assert.equal(await prisma.solicitacaoRelatorio.count({ where: { parceiroId: fixture.parceiroId } }), 1);
});
