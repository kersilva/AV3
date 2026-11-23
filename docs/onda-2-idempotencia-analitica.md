# Onda 2 — Reivindicação atômica e análise idempotente

## Status

Implementada e validada em ambiente efêmero. A estratégia usa lease no Postgres com token aleatório e versão crescente. O processamento concorrente reagenda o job no BullMQ com atraso, sem marcar sucesso. A versão funciona como fencing token nas gravações finais.

## Lógica atual

- `processarRelatorioJob` lê a solicitação, verifica estados finais e depois faz uma atualização separada para `PROCESSANDO` e incrementa `tentativas`.
- Essa leitura e atualização não formam uma reivindicação atômica. Dois workers podem observar a solicitação antes de qualquer um atualizar o estado.
- `AnaliseService.executar` cria uma `ExecucaoAnalise` com ID aleatório dentro de sua própria transação e persiste métricas/previsões.
- No fim da análise, o resultado resumido é gravado em `SolicitacaoRelatorio.resultado`. Uma repetição posterior pode reutilizar esse resultado, mas duas análises simultâneas podem criar execuções diferentes antes que qualquer uma grave o resumo.
- `jobId` estável no BullMQ evita jobs lógicos duplicados em várias republicações, mas não protege sozinho contra entrega stalled ou lock expirado com um processo antigo ainda ativo.
- O schema atual não tem relação única direta entre `ExecucaoAnalise` e `SolicitacaoRelatorio`. `PrevisaoVidaUtil` pode carregar `solicitacaoRelatorioId`, mas isso não garante uma única execução analítica por solicitação.

## Objetivo final

Garantir, em Postgres e entre processos diferentes, que apenas um worker seja dono do processamento corrente e que uma solicitação tenha no máximo uma execução analítica lógica. Após uma queda, outro worker deve poder retomar com segurança sem perder a intenção registrada.

## Decisão técnica que precisa ser fechada

Antes de codificar, especificar:

1. Como uma reivindicação é adquirida atomicamente (por exemplo, atualização condicional de estado/token em uma única transação).
2. Como o dono renova a reivindicação enquanto a análise está ativa.
3. Como um worker concorrente se comporta quando existe reivindicação válida: aguarda/reagenda sem consumir retries de negócio nem marcar o job como concluído prematuramente.
4. Como outro worker recupera uma reivindicação expirada e como um worker antigo é impedido de confirmar resultado após perder a posse (fencing/version token).
5. Como a chave única de execução é aplicada e como a análise perdedora recupera o resultado já persistido, em vez de criar outra execução.
6. Como erros transitórios e terminais liberam ou preservam a reivindicação para que BullMQ e a outbox mantenham o fluxo atual.

### Decisão adotada

- `SolicitacaoRelatorio` terá `leaseToken`, `leaseExpiresAt` e `claimVersion`. Uma instrução SQL condicional faz o claim, incrementa `tentativas` e a versão de forma atômica.
- Lease inicial de 2 minutos, renovado a cada 30 segundos enquanto o processador estiver ativo. A duração é configurável por variável de ambiente para testes e operação.
- Quando há lease válido, o processador usa `job.moveToDelayed` e lança `DelayedError`. Isso mantém o job pendente sem consumir retry e sem confirmar conclusão.
- Conclusão, erro, duração e resultado só podem ser persistidos com `leaseToken` + `claimVersion` atuais. Worker que perdeu a posse não confirma estado.
- `ExecucaoAnalise.solicitacaoRelatorioId` será opcional e único. Execuções históricas e análises sem solicitação continuam válidas.
- O erro transitório libera o lease antes de propagar a falha para o retry existente. Na tentativa final, o listener registra FALHOU de forma condicional e também libera o lease.

Não assumir que somente um `updateMany` com status `PENDENTE` resolve o caso: retries já deixam a solicitação em `PROCESSANDO`, e um worker stalled pode continuar ativo após perder o lock Redis.

## Arquivos previstos

- `api/prisma/schema.prisma` — campos de posse/expiração/geração e relação única da execução, conforme a decisão técnica.
- `api/prisma/migrations/<timestamp>_reivindicacao_analise_idempotente/migration.sql` — migração aditiva; revisar constraints e compatibilidade com dados seed.
- `api/src/generated/prisma/**` — client gerado após alterar o schema.
- `api/src/modules/apiPublica/processarRelatorioJob.ts` — adquirir, renovar, liberar e validar posse; retomar resultado já persistido.
- `api/src/modules/analise/AnaliseService.ts` — associar execução à solicitação e tratar colisão concorrente de forma idempotente.
- `api/src/modules/apiPublica/RelatorioApiService.ts` — consultar reivindicação/estado no reconciliador apenas se a decisão exigir isso.
- `api/src/worker.ts` — política para job concorrente e ajustes configuráveis de lock/lease, sem mascarar falha real.
- `api/tests/integration/ReportClaim.integration.test.ts` — testes de concorrência e retomada.
- `api/scripts/runIntegrationTests.mjs` — aplicar a migração nova antes dos testes.

Arquivos adicionais devem ser registrados neste documento quando surgirem durante a implementação.

## Testes automatizados propostos

1. **Duas chamadas simultâneas para a mesma solicitação:** iniciar dois processadores/workers, sincronizar uma barreira antes da análise e provar que somente um adquire a posse e cria a execução.
2. **Worker concorrente durante lease válido:** comprovar que a segunda entrega não inicia outra análise, não conclui o job prematuramente e não esgota os retries de negócio.
3. **Recuperação após lease expirar:** simular perda abrupta do processo; após expiração, outro worker reivindica a solicitação e termina.
4. **Fencing token:** deixar o worker antigo retomar depois de o segundo adquirir posse e comprovar que o antigo não pode gravar resultado/estado terminal.
5. **Uma execução por solicitação:** consultar Postgres após concorrência e conferir uma única linha `ExecucaoAnalise` associada à solicitação e um único resumo persistido.
6. **Solicitações independentes:** duas solicitações diferentes podem processar ao mesmo tempo e criam uma execução cada, sem bloquear uma à outra.
7. **Retry após falha transitória:** a falha libera ou mantém a posse conforme a política; o retry conclui uma única execução e os contadores continuam corretos.
8. **Migração com solicitações antigas:** aplicar a migração sobre banco seed e confirmar que linhas existentes recebem valores compatíveis, sem apagar dados.

Os testes devem controlar a barreira/relógio ou usar TTLs configuráveis curtos em ambiente de teste. Não usar sleeps frágeis em produção nem reduzir os limites de produção para acelerar teste.

## Resultado esperado

- Duas entregas da mesma solicitação não executam o cálculo ao mesmo tempo.
- Reentrega após queda produz uma única execução analítica lógica e um único resultado final.
- Um processo antigo não sobrescreve o resultado de um worker que assumiu a solicitação depois da expiração.
- Solicitações diferentes continuam processáveis em paralelo.

## Critério de aceite

- A aquisição é comprovadamente atômica sob concorrência real com PostgreSQL.
- A regra de lease/expiração e o comportamento da segunda entrega estão documentados.
- Testes de corrida passam repetidamente sem depender de ordem de agendamento.
- Build, lint, 8 testes unitários e 6 testes de integração passam; a migração foi aplicada em banco efêmero e no Postgres local (`greencode`, `localhost:5433`). `prisma migrate status` confirma schema atualizado.

## Registro de testes adicionais durante a implementação

Ao descobrir uma corrida ou janela de falha sem cobertura, adicionar primeiro um teste de regressão. Registrar aqui nome, arquivo, sequência de concorrência reproduzida, regra esperada e resultado. Atualizar o registro no mesmo commit da correção.

- `ReportClaim.integration.test.ts` — reproduz worker concorrente sob lease ativo, expira lease enquanto o primeiro está parado em barreira, conclui com segundo worker e retoma o antigo. Espera duas tentativas de negócio, uma execução analítica e nenhuma gravação final pelo worker antigo. Adicionado porque o teste de claim simples não detecta worker pausado que volta após a expiração.
- `processarRelatorioJob.ts` — o claim é feito antes da leitura dos parâmetros e incremento de tentativas no SQL atômico; isso fecha a janela entre leitura e atualização observada no fluxo anterior.
- O teste de claim também cobre o reagendamento via `moveToDelayed` e confirma que o listener de falha de uma entrega antiga não muda o estado quando outro worker possui lease válido.
