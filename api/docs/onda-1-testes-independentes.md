# Onda 1 — Testes independentes do processamento concorrente

## Status

Concluída. Os arquivos de teste são separados e o runner descobre todos os `*.integration.test.ts`, executando-os em sequência no mesmo ambiente efêmero.

## Lógica atual

- `RelatorioApiService.solicitar` persiste solicitação e outbox em uma transação serializável. A chave idempotente é única por parceiro, e o conteúdo da requisição é comparado por fingerprint.
- O worker usa três tentativas BullMQ. Ao receber o último evento `failed`, `worker.ts` atualiza a solicitação para `FALHOU` e guarda uma mensagem genérica para o parceiro.
- `GET /api/v1/public/relatorios/:id` busca status por ID e parceiro dono.
- `GET /api/v1/public/relatorios/:id/download` só permite download quando o status é `CONCLUIDO` e o parceiro é o dono.
- O despacho da outbox ocorre no worker, no início e a cada cinco segundos. O processo HTTP não é dono desse ciclo; reiniciar somente a API não deve ser tratado como reinício do dispatcher.
- A suíte de integração cobre retry transitório, reinícios de Redis/worker, falha permanente, concorrência na chave pública, status/download com autorização real e reinício do servidor HTTP.

## Objetivo final

Completar os cenários que não dependem da reivindicação concorrente do worker. Eles validam contratos públicos e estados terminais antes de alterar o mecanismo de reivindicação do processamento.

## Arquivos previstos

- `api/tests/integration/OutboxFailure.integration.test.ts` — esgotamento dos retries.
- `api/tests/integration/ApiIdempotency.integration.test.ts` — solicitações concorrentes com a mesma chave.
- `api/tests/integration/ReportApi.integration.test.ts` — status, download e autorização do parceiro.
- `api/tests/integration/ApiRestart.integration.test.ts` — reinício do processo HTTP e continuidade da API.
- `api/scripts/runIntegrationTests.mjs` — descobrir os arquivos `*.integration.test.ts`, em vez de apontar para um teste único.
- `api/package.json` — manter o comando `test:integration` como entrada única da suíte.
- `api/src/worker.ts` — alterar apenas se o teste de falha permanente revelar defeito no estado final.
- `api/src/modules/apiPublica/RelatorioWorkerEvents.ts` — função compartilhada pelo callback de falha do worker e pelo teste de falha permanente.
- `api/src/modules/apiPublica/RelatorioApiService.ts` — alterar apenas se o teste concorrente revelar defeito em idempotência/fingerprint.
- `api/src/modules/apiPublica/RelatorioApiController.ts` — alterar apenas se status/download divergir do contrato esperado.

Os nomes dos testes e arquivos são sugestões. Se a implementação usar outros nomes, atualizar este documento junto com o código.

## Trabalho paralelo recomendado

1. Desenvolver o teste de falha permanente.
2. Desenvolver o teste concorrente de idempotência.
3. Desenvolver status/download e autorização cruzada.
4. Desenvolver a inicialização e o reinício do processo HTTP.

Esses fluxos exercitam comportamentos diferentes. Cada teste deve ter IDs próprios e não depender de um CNPJ fixo compartilhado. Como todos usam o mesmo Compose durante uma execução, o runner deve executá-los em sequência.

## Testes automatizados propostos

### Falha permanente

- Forçar falha em todas as tentativas configuradas.
- Esperar o estado `FALHOU` no Postgres.
- Conferir que `tentativas` tem o valor esperado, a mensagem externa é genérica e o job fica retido como failed para diagnóstico.
- Conferir que uma solicitação concluída ou cancelada não volta para `FALHOU` por um evento tardio.

### Idempotência pública concorrente

- Enviar várias chamadas simultâneas com mesmo parceiro, chave e corpo.
- Conferir uma linha em `SolicitacaoRelatorio`, uma linha em `OutboxRelatorio` e um único `jobId` lógico; as respostas devem devolver o mesmo ID.
- Repetir a mesma chave com corpo diferente e conferir conflito, sem criar outra solicitação.
- Fazer a concorrência com mais de duas chamadas para exercitar conflitos `P2002` e `P2034`.

### Status, download e autorização

- Criar um relatório e consultar status com chave válida do parceiro dono.
- Confirmar que outro parceiro não consegue consultar nem baixar o relatório.
- Confirmar que download antes de `CONCLUIDO` retorna não encontrado/negação conforme o contrato atual.
- Após conclusão, baixar JSON e verificar `execucaoId`, tipo e estrutura do documento.

### Reinício do servidor HTTP

- Iniciar a API como processo filho conectado ao banco e ao Redis efêmeros.
- Fazer uma chamada pública, encerrar o processo HTTP e iniciá-lo novamente.
- Consultar a solicitação persistida depois do restart.
- Separar este teste do despacho da outbox: o worker é quem executa a publicação periódica. Para provar retomada de outbox, reiniciar o worker, não apenas a API.

## Resultado esperado

- Os caminhos terminal, idempotente e de download ficam protegidos por testes de integração.
- Reiniciar o HTTP não apaga o estado persistido nem quebra a consulta do parceiro.
- Falhas identificadas nesta onda são corrigidas antes da proteção concorrente da Onda 2.

## Resultado observado

- `ApiIdempotency.integration.test.ts` passou: oito chamadas concorrentes retornaram o mesmo ID; Postgres manteve uma solicitação/outbox; BullMQ manteve um job lógico; corpo diferente com a mesma chave foi recusado.
- `ApiRestart.integration.test.ts` passou: a consulta pública retornou o mesmo estado antes e depois de reiniciar o processo HTTP; chave inválida foi recusada.
- `OutboxFailure.integration.test.ts` passou: três tentativas terminaram em `FALHOU`, o job ficou retido como `failed` e a mensagem pública não revelou a exceção interna.
- `ReportApi.integration.test.ts` passou: parceiro dono consultou status e baixou JSON; parceiro diferente não consultou nem baixou; relatório pendente não foi baixado.
- O runner executou esses quatro arquivos e `OutboxRecovery.integration.test.ts`: 5 testes passaram, nenhum falhou. Build, lint, testes unitários e `git diff --check` também passaram durante a implementação.
- O ambiente Compose efêmero, seu volume Redis e a pasta temporária foram removidos ao final da execução.

## Critério de aceite

- Todos os testes acima passam no banco e Redis efêmeros.
- Não há registros compartilhados entre testes; o cleanup remove apenas as fixtures da execução.
- O runner executa todos os arquivos de integração e também encerra os recursos quando um teste falha.

## Registro de testes adicionais durante a implementação

Ao encontrar um comportamento sem cobertura, primeiro criar o teste que reproduz o caso. Depois da correção, adicionar aqui o nome e o caminho do teste, a regra coberta e o resultado observado. Manter esse registro no mesmo commit da mudança correspondente.

- Nenhum cenário fora da lista planejada foi necessário. O callback final do worker foi extraído para `RelatorioWorkerEvents.ts` para que o teste exercite a mesma regra de produção, sem importar o arquivo que inicia o worker.
