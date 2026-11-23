# Onda 3 — Recuperação após interrupção do worker

## Status

Implementada e validada em ambiente efêmero. Três processos BullMQ foram encerrados abruptamente em checkpoints distintos e os jobs foram recuperados sem duplicar a execução analítica.

## Lógica atual

- O worker consome jobs BullMQ com `lockDuration: 120_000` e `maxStalledCount: 1`.
- O handler chama `processarRelatorioJob`, que calcula o relatório, grava JSON temporário e renomeia para o caminho final.
- Se o processo termina sem encerramento gracioso, o Redis deixa o lock expirar e BullMQ pode marcar o job como stalled e reentregá-lo.
- O teste de integração atual fecha um worker vazio antes de criar a solicitação e inicia outro depois. Ele prova reinício com job pendente, mas não interrupção durante cálculo ativo.
- O estado da outbox é reconciliado a cada cinco segundos pelo worker. Isso recupera publicação ausente/terminal, mas não substitui a reivindicação no Postgres para evitar execução analítica concorrente.

## Objetivo final

Provar que uma análise ativa pode ser interrompida abruptamente, retomada por um novo worker e concluída sem perda da solicitação, sem estado preso e sem duplicar execução, resultado ou arquivo.

## Arquivos previstos

- `api/tests/integration/WorkerCrashRecovery.integration.test.ts` — orquestrar os dois processos e verificar recuperação.
- `api/scripts/workerCrashFixture.ts` — worker filho real usado somente pela suíte de integração, com IPC para sinalizar checkpoint e conclusão.
- `api/src/worker.ts` — permitir configurar lock/poll/stalled options em teste e garantir encerramento normal; defaults de produção permanecem explícitos.
- `api/src/modules/apiPublica/processarRelatorioJob.ts` — checkpoints seguros, validação de posse e repetição idempotente do arquivo/estado.
- `api/src/modules/analise/AnaliseService.ts` — reuso da execução/resultados após retomada.
- `api/src/modules/apiPublica/RelatorioApiService.ts` — ajuste da reconciliação se o resultado observar uma janela não coberta.
- `api/scripts/runIntegrationTests.mjs` — descoberta e execução deste cenário no mesmo ambiente efêmero.
- `compose.integration.yaml` — só se for necessário controlar persistência ou healthcheck para o cenário; não reutilizar os containers de desenvolvimento.
- `docs/onda-2-idempotencia-analitica.md` — registrar qualquer mudança na regra de lease/idempotência exigida pelo teste.

## Estratégia de teste

Executar um processo worker filho contra Postgres e Redis efêmeros. O teste deve sinalizar, por IPC ou uma barreira controlada, quando a solicitação já está reivindicada e a análise está ativa. Então encerra o processo de forma abrupta; não usar somente `worker.close()`, pois isso é encerramento gracioso.

Configurar lock/lease curtos exclusivamente no processo de teste. Aguardar o estado recuperável por evento/consulta com limite folgado e relógio controlável. Evitar depender de um sleep fixo longo de 120 segundos.

## Testes automatizados propostos

1. **Crash antes do commit analítico:** encerrar o processo durante a análise, iniciar outro worker e confirmar retomada/conclusão.
2. **Crash após commit analítico e antes de gravar JSON:** reiniciar worker; ele deve reutilizar o resultado persistido e completar o arquivo sem uma nova execução.
3. **Crash após JSON e antes do status concluído:** reiniciar worker; ele deve reconhecer o arquivo/resultados persistidos e marcar conclusão idempotentemente.
4. **Worker antigo após lease perdido:** permitir que o processo antigo retome depois que o novo worker adquirir posse; conferir fencing rejeita sua gravação.
5. **Limite de tentativas/stalled:** confirmar comportamento final esperado de BullMQ sem `FALHOU` prematuro antes da recuperação configurada.
6. **Arquivo final:** validar JSON parseável, nome por ID estável, ausência de `.tmp` abandonado após recuperação e uma única execução associada.
7. **Estado recuperado:** confirmar `CONCLUIDO`, duração acumulada coerente e outbox sem republicações contínuas.

## Resultado esperado

- O worker reiniciado encontra o job stalled ou a solicitação recuperável e termina o trabalho.
- O resultado analítico e o arquivo são únicos por solicitação.
- Repetir o processamento depois de qualquer checkpoint não corrompe o JSON nem volta o estado terminal.
- Métricas de processo podem reiniciar; os dados duráveis de tentativa, duração e status ficam no Postgres.

## Critério de aceite

- O cenário usa processos reais de worker, uma terminação abrupta e Redis/Postgres efêmeros.
- O teste falha se houver duas execuções analíticas, dois JSONs lógicos, estado preso ou worker antigo sobrescrevendo o novo.
- O runner limpa processos, containers, volume de Redis e diretório temporário em sucesso ou falha.

Resultado: build, lint, testes unitários e integração validados; a migração foi aplicada pelo runner no Postgres efêmero. Os três checkpoints de crash foram recuperados, com uma execução associada, JSON parseável, sem temporários abandonados e job abaixo do limite de retries.

## Registro de testes adicionais durante a implementação

Se a implementação revelar um checkpoint adicional entre Redis, Postgres e arquivo, adicionar um teste para essa janela antes de corrigir o código. Registrar nome, arquivo, ponto de crash e invariante esperado.

- `WorkerCrashRecovery.integration.test.ts` — três crashes abruptos reais: dentro da transação analítica antes da persistência, depois do commit analítico e depois da gravação atômica do JSON. Cada retomada deve terminar `CONCLUIDO`, com uma execução associada, JSON válido, sem temporário abandonado e retries abaixo do limite.
- `AnaliseService.ts` e `processarRelatorioJob.ts` — callback de checkpoint injetável para o teste parar o processo dentro da transação analítica e verificar rollback.
- `worker.ts` — duração do lock e intervalo de detecção stalled configuráveis por ambiente, com os valores de produção anteriores como padrão.
