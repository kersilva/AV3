import assert from 'node:assert/strict';
import test from 'node:test';
import { RelatorioMetrics } from '../src/modules/apiPublica/RelatorioMetrics.js';

test('métricas registram retries, duração e resultado sem rótulos por solicitação', async () => {
  const metricas = new RelatorioMetrics();
  metricas.observarEsperaFila(2_500);
  metricas.iniciarTentativa(1);
  metricas.concluirTentativa('retry', 900);
  metricas.iniciarTentativa(2);
  metricas.concluirTentativa('success', 1_200);
  metricas.concluirSolicitacao('success', 4_800);

  const texto = await metricas.registry.metrics();
  assert.match(texto, /greencode_report_attempts_started_total\s+2/);
  assert.match(texto, /greencode_report_retries_total\s+1/);
  assert.match(texto, /greencode_report_jobs_total\{result="success"\}\s+1/);
  assert.match(texto, /greencode_report_attempt_duration_seconds_count\{result="retry"\}\s+1/);
  assert.match(texto, /greencode_report_attempt_duration_seconds_count\{result="success"\}\s+1/);
  assert.match(texto, /greencode_report_queue_wait_seconds_count\s+1/);
  assert.doesNotMatch(texto, /solicitacaoId|parceiroId/);
});
