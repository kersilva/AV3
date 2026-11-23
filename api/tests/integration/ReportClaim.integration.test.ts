import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { DelayedError, type Job } from 'bullmq';
import { prisma } from '../../src/infrastructure/database.js';
import { processarRelatorioJob } from '../../src/modules/apiPublica/processarRelatorioJob.js';
import { aoFalharJobRelatorio } from '../../src/modules/apiPublica/RelatorioWorkerEvents.js';
import { criarParceiroFixture } from './support.js';

test('claim PostgreSQL serializa workers e impede que worker antigo confirme após retomada', { timeout: 30_000 }, async (context) => {
  const fixture = await criarParceiroFixture(context, 'Claim de relatório');
  const id = randomUUID();
  const dataReferencia = new Date(Date.now() - 10_000);
  await prisma.solicitacaoRelatorio.create({ data: {
    id,
    parceiroId: fixture.parceiroId,
    tipoRelatorio: 'COMPLETO',
    parametros: { organizacaoId: fixture.organizacaoId, dataReferencia: dataReferencia.toISOString() },
  } });

  let liberarWorkerAntigo!: () => void;
  let workerAntigoNaBarreira!: () => void;
  const barreira = new Promise<void>((resolve) => { liberarWorkerAntigo = resolve; });
  const workerAntigoPronto = new Promise<void>((resolve) => { workerAntigoNaBarreira = resolve; });
  const workerAntigo = processarRelatorioJob(id, 1, 3, {
    antesDeExecutarAnalise: async () => { workerAntigoNaBarreira(); await barreira; },
  });
  await workerAntigoPronto;

  let registro = await prisma.solicitacaoRelatorio.findUniqueOrThrow({ where: { id } });
  assert.equal(registro.tentativas, 1);
  await assert.rejects(() => processarRelatorioJob(id, 1, 3), /outro worker/);
  registro = await prisma.solicitacaoRelatorio.findUniqueOrThrow({ where: { id } });
  assert.equal(registro.tentativas, 1, 'worker concorrente não incrementa tentativas de negócio');

  let jobAdiadoAte = 0;
  const jobSimulado = {
    token: 'token-bullmq-de-teste',
    moveToDelayed: async (timestamp: number) => { jobAdiadoAte = timestamp; },
  } as Job;
  await assert.rejects(
    () => processarRelatorioJob(id, 1, 3, { job: jobSimulado }),
    (erro: unknown) => erro instanceof DelayedError,
  );
  assert.ok(jobAdiadoAte >= Date.now() + 1_900, 'entrega concorrente é reagendada sem erro de negócio');

  await aoFalharJobRelatorio(id, 3, 3, new Error('falha de worker antigo'));
  registro = await prisma.solicitacaoRelatorio.findUniqueOrThrow({ where: { id } });
  assert.equal(registro.status, 'PROCESSANDO', 'evento tardio não falha solicitação que tem novo dono');

  await prisma.solicitacaoRelatorio.update({ where: { id }, data: { leaseExpiresAt: new Date(0) } });
  registro = await prisma.solicitacaoRelatorio.findUniqueOrThrow({ where: { id } });
  assert.ok(registro.leaseExpiresAt && registro.leaseExpiresAt.getTime() === 0);
  const retomada = await processarRelatorioJob(id, 2, 3);
  assert.equal(retomada.execucaoId !== undefined, true);
  liberarWorkerAntigo();
  await assert.rejects(workerAntigo, /reivindicação.*perdida/i);

  registro = await prisma.solicitacaoRelatorio.findUniqueOrThrow({ where: { id } });
  assert.equal(registro.status, 'CONCLUIDO');
  assert.equal(registro.tentativas, 2);
  assert.equal(await prisma.execucaoAnalise.count({ where: { solicitacaoRelatorioId: id } }), 1);
  const resumo = registro.resultado as { execucaoId?: string } | null;
  assert.equal(resumo?.execucaoId, retomada.execucaoId);
});
