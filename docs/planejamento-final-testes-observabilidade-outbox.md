# Plano: testes, métricas e recuperação da outbox

## Objetivo

Completar três partes da versão final da AV3:

1. Automatizar testes de integração e medir tentativas e duração dos relatórios.
2. Confirmar que solicitações não se perdem quando Redis, API ou worker param e reiniciam.
3. Separar as rotas internas/administrativas das rotas públicas e versionar cada contrato de forma independente.

Este documento registra o plano aprovado e o estado da implementação.

## Estado anterior à execução do plano

- A API grava `SolicitacaoRelatorio` e `OutboxRelatorio` no Postgres antes de publicar o job.
- A publicação usa o ID da solicitação como `jobId` BullMQ. Uma publicação repetida tende a usar o mesmo job.
- Se a publicação falha, a API mantém a outbox pendente. O worker tenta publicar pendências ao iniciar e a cada cinco segundos.
- O Compose configura Redis com AOF e volume persistente.
- O job tem três tentativas, espera exponencial a partir de cinco segundos e jobs falhos ficam retidos no BullMQ.
- A solicitação guarda `tentativas`, horários de criação/conclusão, resultado analítico e URL de download.
- O worker não tem métricas de duração nem log estruturado para cada início, retry e conclusão.
- Ainda não há teste automatizado que pare Redis ou reinicie API/worker durante a publicação.

## Estado da implementação

### Implementado nesta etapa

- Rotas públicas em `/api/v1/public` e rotas internas/de gestão em `/api/v1/internal`.
- Aliases para caminhos internos legados, com cabeçalhos de depreciação e successor-version.
- Métricas Prometheus para tentativas, retries, resultado dos jobs, espera na fila, duração por tentativa, duração total e jobs ativos.
- Duração e timestamps de processamento persistidos em `SolicitacaoRelatorio` por migração aditiva.
- Endpoint local `/metrics` no processo worker, configurável por `METRICS_HOST` e `METRICS_PORT`.
- Timeouts na publicação/consulta Redis; a API mantém a solicitação aceita no Postgres mesmo se Redis não responder.
- Reconciliação de outbox publicada que detecta job ausente ou terminal e publica novamente com `jobId` estável.
- Teste de integração isolado que aplica migrações num Postgres efêmero e usa Redis com AOF e volume temporário. O runner escolhe portas aleatórias e remove seus próprios recursos no final.
- Cenário de integração cobre Redis fora antes da publicação, queda após Redis aceitar o job, deduplicação por `jobId`, reinício do Redis e reinício do worker. Uma falha transitória simulada confirma retry, duração persistida e conclusão.

### Concluído nesta etapa

- Onda 2: claim atômico no Postgres, lease renovável com fencing, reagendamento concorrente no BullMQ e relação única entre solicitação e execução analítica.
- Onda 3: três encerramentos abruptos em checkpoints reais recuperam jobs sem duplicar execução ou arquivo lógico.
- Onda 4: build, lint, 8 testes unitários, cleanup por falha/sinal simulado e duas execuções da suíte de integração passaram.

### Pendências residuais

- Aplicar a migração da Onda 2 no Postgres local quando voltar a responder. A validação efêmera passou; o banco local em `localhost:5433` estava indisponível e não foi alterado.
- Registrar a data de publicação para iniciar a contagem de 90 dias dos aliases internos; o prazo mínimo está documentado no README.

Os cenários de falha permanente, idempotência concorrente, reinício HTTP, consulta/download e autorização por parceiro foram implementados na Onda 1. Os resultados estão em [onda-1-testes-independentes.md](onda-1-testes-independentes.md).

## Ordem otimizada para concluir os itens pendentes

Os detalhes por onda estão separados para orientar implementação e revisão:

- [Onda 1 — testes independentes](onda-1-testes-independentes.md)
- [Onda 2 — reivindicação e idempotência analítica](onda-2-idempotencia-analitica.md)
- [Onda 3 — recuperação do worker ativo](onda-3-recuperacao-worker-ativo.md)
- [Onda 4 — validação integral](onda-4-validacao-integral.md)

### Onda 1 — Itens independentes, em paralelo

Estes trabalhos podem avançar ao mesmo tempo, em arquivos de teste separados:

- **Falha permanente:** consumir os retries e conferir `FALHOU`, mensagem pública genérica e job retido.
- **Idempotência concorrente:** enviar a mesma chave em paralelo e conferir uma solicitação e uma outbox.
- **Contrato e download:** consultar o status, baixar o JSON como parceiro dono e negar o download para outro parceiro.
- **Reinício da API com outbox pendente:** reiniciar somente o processo HTTP e conferir que o worker publica a pendência.
- **Prazo dos aliases:** manter a política de 90 dias e registrar a data real de início no momento da publicação; não iniciar a contagem no commit de código.

Os cenários devem usar fixtures exclusivas e não devem compartilhar IDs fixos. O runner pode executar os arquivos em sequência para evitar disputa por banco, Redis ou arquivos de relatório.

### Onda 2 — Proteção contra processamento duplicado

Antes de simular a interrupção de uma análise ativa, tornar a reivindicação e a persistência da análise idempotentes no Postgres. A proposta é vincular a execução analítica à solicitação com uma restrição única e fazer a aquisição/liberação da reivindicação de forma atômica. Definir também como um worker concorrente se comporta enquanto a reivindicação está válida e como a retomada ocorre depois de expirar. Essa regra deve cobrir workers separados e jobs stalled, não apenas chamadas duplicadas no mesmo processo.

Esta onda bloqueia o teste de interrupção do worker. Ela também reduz o risco de duplicar registros analíticos se o BullMQ entregar um job novamente.

### Onda 3 — Interrupção do worker durante análise

Com a proteção da Onda 2, matar o processo depois da reivindicação e durante a análise; reiniciar outro worker; conferir retomada, estado terminal, uma única execução analítica e um único JSON válido. Incluir uma pausa longa o bastante para exercitar lease/lock expirado, sem depender de temporizações curtas.

### Onda 4 — Validação conjunta

Executar build, lint, testes unitários e todos os testes de integração contra o Compose efêmero. Confirmar o cleanup em sucesso e falha. Corrigir o plano e o README se os resultados mudarem alguma decisão ou prazo.

### Caminho crítico

`proteção atômica/idempotente no Postgres` → `teste de worker interrompido durante análise` → `validação integral`.

As demais atividades da Onda 1 não dependem desse caminho crítico e podem avançar enquanto a solução de reivindicação é desenhada e implementada.

## Decisões propostas

1. Usar `node:test`, já usado pelos testes atuais, com serviços reais de PostgreSQL e Redis em uma configuração de teste isolada.
2. Não apontar os testes para o banco local de desenvolvimento. Usar `compose.integration.yaml` com banco e volume próprios; exigir uma URL com sufixo `_test` antes de qualquer limpeza automática.
3. Separar o processamento do job em uma função exportável e injetar um ponto de falha controlado para testar retries sem depender de falhas reais de rede.
4. Manter entrega *at least once*: a fila pode chamar um job novamente. A aplicação deve garantir um único resultado lógico por `solicitacaoId`, em vez de depender de execução exatamente uma vez.
5. Medir duas durações: espera na fila (`criadoEm` até início) e processamento (início até conclusão/falha). `tentativas` continua sendo o total persistido por solicitação.
6. Usar logs estruturados por tentativa e métricas de contador/histograma. Se for adotado Prometheus, expor métricas do processo worker em endpoint local/configurável; métricas em memória podem zerar após reinício, enquanto `tentativas` e estados no Postgres continuam duráveis.

## Etapa 0 — Separar e versionar rotas internas

- Inventariar as rotas e separar as operações públicas, administrativas e de usuário interno.
- Manter rotas de parceiros em `/api/v1/public`; migrar rotas de equipe e gestão para `/api/v1/internal`.
- Usar chaves e escopos no prefixo público. Usar JWT e os papéis atuais no prefixo interno.
- Registrar aliases temporários para caminhos internos legados, ligados aos mesmos handlers e regras de autorização.
- Atualizar Swagger e README. Definir e documentar o prazo para remover aliases antigos.
- Manter contratos público e interno versionados de forma independente. Mudanças incompatíveis com parceiros exigem nova versão pública e depreciação gradual.

**Aceite:** cada rota pública só aceita chave de parceiro; cada rota interna exige JWT e papel; nenhuma operação administrativa fica sob o prefixo público; aliases internos continuam funcionais durante a transição.

## Etapa 1 — Preparar testes de integração

- Criar serviço de teste isolado para Postgres e Redis, com health checks e configuração de portas separadas.
- Adicionar comando explícito, por exemplo `npm run test:integration --workspace=api`.
- Preparar fixtures pequenas e determinísticas, sem depender da senha ou dos dados do seed de desenvolvimento.
- Adicionar proteção que recuse execução destrutiva se a URL não apontar para um banco de teste.
- Exportar uma fábrica do worker/processador para testes. Permitir injetar uma falha temporária e um relógio controlado, sem mudar o comportamento padrão.

**Aceite:** testes iniciam e encerram os próprios recursos; falha de setup não altera o banco/Redis de desenvolvimento.

## Etapa 2 — Medir retries e duração

- Registrar início e fim de cada tentativa com `solicitacaoId`, número da tentativa, resultado e `duracaoMs`.
- Medir espera na fila e duração de processamento com relógio monotônico; não usar diferença de relógio do sistema para duração curta.
- Manter `tentativas` no Postgres como total durável. Avaliar adicionar `processamentoIniciadoEm`, `ultimaDuracaoMs` e `duracaoTotalMs` para consulta de cada solicitação.
- Expor métricas: tentativas por resultado, jobs concluídos/falhos e histogramas de espera e processamento.
- Não incluir chave de API, segredo ou conteúdo sensível nos logs e rótulos das métricas.

**Aceite:** um teste provoca uma falha transitória e depois sucesso; banco e logs registram duas tentativas, uma conclusão e duração positiva. Outro teste esgota as tentativas e confirma estado `FALHOU` e contagem final correta.

## Etapa 3 — Tornar publicação e processamento recuperáveis

- Manter `PENDENTE` até o job existir no Redis; atualizar para `PUBLICADO` somente depois de `queue.add` confirmar.
- Preservar o `jobId` estável com `solicitacaoId` em todo retry de publicação.
- Tornar a reclamação da solicitação atômica no Postgres. Se o job for entregue duas vezes ou um lock BullMQ expirar, duas execuções não podem iniciar o mesmo cálculo ao mesmo tempo.
- Persistir resumo analítico e associação à solicitação na mesma transação, como já feito; uma retomada após esse commit deve apenas gravar/conferir o arquivo e concluir o status.
- Adicionar reconciliação periódica para solicitações que permanecem `PENDENTE` ou `PROCESSANDO` além de um prazo: consultar o estado do job no BullMQ e republicar quando o job não existir mais. A reconciliação não deve reenfileirar jobs ativos ou já concluídos.
- Manter Redis AOF/volume no Compose e fechar conexões com encerramento gracioso.

**Aceite:** uma solicitação permanece recuperável depois de uma falha entre commit no Postgres, publicação no Redis, atualização da outbox e gravação do arquivo. A recuperação não cria uma segunda execução analítica.

## Etapa 4 — Cenários automatizados

1. **Fluxo normal:** criar solicitação; confirmar uma outbox/job; aguardar `CONCLUIDO`; baixar JSON e conferir uma execução ligada à solicitação.
2. **Retry transitório:** falhar uma tentativa por injeção; confirmar retry, contagem e conclusão sem duplicar execução.
3. **Falha permanente:** falhar todas as tentativas; confirmar `FALHOU`, mensagem pública genérica e job retido para diagnóstico.
4. **Redis indisponível antes da publicação:** parar Redis, solicitar relatório, confirmar resposta aceita e outbox `PENDENTE`; iniciar Redis e worker; confirmar publicação e conclusão.
5. **Worker/API reiniciados com outbox pendente:** reiniciar processos; confirmar despacho no início ou no próximo ciclo de cinco segundos.
6. **Queda após publicar no Redis, antes de marcar a outbox:** repetir despacho; confirmar o mesmo `jobId` e um único resultado lógico.
7. **Worker interrompido durante o job:** reiniciar o worker; confirmar recuperação do job stalled ou da solicitação presa e conclusão sem análise duplicada.
8. **Redis reiniciado:** reiniciar Redis com AOF/volume; confirmar jobs persistidos ou reparo pela reconciliação do Postgres.
9. **Idempotência concorrente:** enviar solicitações simultâneas com a mesma chave; confirmar uma solicitação, uma outbox e um job lógico.
10. **Separação de rotas:** testar prefixos público e interno com credenciais trocadas; confirmar negação e ausência de acesso entre os contratos.

## Critérios finais de aceite

- Build, lint, testes unitários e testes de integração passam em sequência a partir de uma instalação limpa documentada.
- Uma indisponibilidade temporária de Redis não perde uma solicitação já aceita pelo Postgres.
- Reiniciar API, worker ou Redis não deixa uma solicitação pendurada sem caminho de recuperação.
- Retries e durações podem ser consultados por solicitação; métricas agregadas não carregam identificadores de alta cardinalidade.
- Cada solicitação concluída tem exatamente um resultado lógico e um arquivo JSON baixável pelo parceiro dono.
- Testes não usam nem limpam o banco de desenvolvimento.

## Fora do escopo desta etapa

- Alta disponibilidade de Redis, clusterização e múltiplos workers em escala.
- Um broker alternativo ou garantia de execução física exactly-once.
- Webhooks, expiração de relatórios ou troca do formato JSON.
- Testes de carga para centenas de parceiros.

## Riscos a tratar durante a implementação

- Existe uma janela de entrega entre Postgres e Redis; a outbox e a reconciliação tratam a repetição, mas a idempotência do worker deve proteger o cálculo.
- Uma métrica apenas em memória desaparece no reinício. Contagens por solicitação no Postgres preservam o histórico útil.
- Testes que param serviços podem afetar dados se apontarem para o Compose de desenvolvimento; isolamento e guarda da URL de teste são obrigatórios.
- Tempos de processamento variam com o volume do seed e o hardware. Usar limites folgados de timeout e verificar estados/resultados, não comparar com tempos muito curtos.
