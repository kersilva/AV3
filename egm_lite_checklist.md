# Checklist de implementação — MVP até a versão final AV3

**Branch:** `av3/entrega`
**Commit inicial:** `0fea8dd chore: versiona client gerado com modelos de análise`
**Estado inicial:** `docs/planejamento-mvp-av3.md` e `docs/regras-analiticas-av3.md` estão não rastreados. Preservar e não incluir em commits sem revisar o diff e confirmar que pertencem a esta tarefa. Usuário confirmou que o banco local contém somente dados do seed; perda desses registros é aceitável e eles podem ser recriados.

## Fase 0 — Contrato de dados e migrações

- [x] [Schema Prisma](api/prisma/schema.prisma): meses previstos/erro usam Decimal; valor realizado tem referência e estimativa guarda contagem e nível de amostra.
- [x] [Migração AV3](api/prisma/migrations/20261123120000_precisao_e_comprovante_analises/migration.sql): migração aditiva para precisão, referência e nível da estimativa. Não reescreve migração aplicada.
- [x] [Seed](api/prisma/seed.ts): cobre seis falhas por tipo, sobreviventes, datas distribuídas, falhas futuras a um corte histórico e valores de demonstração.
- [x] [Planejamento](docs/planejamento-mvp-av3.md) e [regras analíticas](docs/regras-analiticas-av3.md): eficiência começa no evento RECEBIDO; meses fracionários preservados; agrupamento usa responsável da conclusão.
- [ ] Antes de qualquer migração destrutiva, confirmar que o alvo é o banco local de desenvolvimento; como contém somente dados do seed, recriação é permitida e o seed deve ser executado novamente.

## Fase 1 — MVP analítico síncrono

- [x] Implementar consultas tipadas para históricos de lotes/estado, lotes, equipamentos e valores, respeitando exclusões lógicas e data de referência.
- [x] Implementar eficiência por lote do primeiro `RECEBIDO` à primeira conclusão, média, contagens e agrupamentos independentes por mês e operador.
- [x] Implementar recuperação bruta com comprovante, referência à data de estimativa e fallback tipo/estado; registrar estimativa, amostras e nível de correspondência.
- [x] Reutilizar `ORDEM_ESTADO`; implementar OLS com corte temporal, mínimo de cinco falhas, limites válidos e motivos de insuficiência.
- [x] Persistir execuções, métricas e previsões; expor execução e consulta histórica em rotas internas autenticadas.
- [x] Atualizar Swagger e README com unidades, regras, limitações e dados de demonstração.
- [x] Adicionar testes unitários de cálculo para eficiência, OLS e fallback de recuperação.

## Fase 2 — Validação e auditabilidade

- [x] Gravar validações apenas para primeiras falhas posteriores a `dataPrevisao`, com idade e erro Decimal.
- [x] Adicionar referência persistida para comprovante e validar preenchimento/data no serviço.
- [ ] Testar integração: itens de treino não são validados na mesma previsão e execuções históricas permanecem separadas.

## Fase 3 — API pública

- [ ] Implementar gestão administrativa de parceiros e emissão/revogação de chave com exibição única do segredo e armazenamento de hash/prefixo.
- [ ] Implementar `/api/v1/public`, autenticação por chave, escopos, rate limit por chave/parceiro e erros estáveis.
- [ ] Implementar endpoints versionados de rastreabilidade, lotes e relatórios, com autorização por escopo e parceiro.
- [ ] Aplicar `Idempotency-Key` a escritas compatíveis; documentar exemplos e respostas no OpenAPI.
- [ ] Adicionar testes de chave inválida/revogada, escopo, isolamento de rate limit, idempotência e vazamento de segredo.

## Fase 4 — Processamento assíncrono e entrega final

- [ ] Adicionar Redis/BullMQ e worker separado; configurar tentativas, backoff, timeout e fila de falhas.
- [ ] Persistir solicitação antes de publicar job e implementar outbox/reenvio para falha entre Postgres e Redis.
- [ ] Tornar transições do worker idempotentes; restringir status/arquivo ao dono da solicitação; implementar expiração de resultados.
- [ ] Gerar e entregar CSV/JSON sem expor caminhos internos; registrar métricas/logs por solicitação.
- [ ] Atualizar Compose e documentação para Windows 10+ e Ubuntu 24.04.03+.
- [ ] Verificar instalação limpa, migrações, seed, build e testes em cada plataforma disponível; listar limitações de validação que exijam ambiente externo.

## Revisão e commits

- [ ] Antes de editar, preservar os diffs existentes e registrar o baseline desta tarefa.
- [ ] Criar commits de segurança separados nos marcos: contrato/migrações, MVP analítico, validação, API pública e fila/versão final. Revisar staged diff para não incluir alterações alheias.
- [ ] Fazer revisão Goldfish do checklist antes da implementação e revisão do diff após cada conjunto funcional.

## Verificações empíricas adiadas

- [ ] Confirmar migração com uma cópia de banco contendo valores legados de `Movimentacao`; verificar conversão e rollback.
- [ ] Executar worker com Redis indisponível no momento da publicação e comprovar recuperação por outbox/reenvio.
- [ ] Verificar comandos e dependências em Windows e Ubuntu; este ambiente local só confirma a plataforma em que as verificações forem executadas.

## Riscos de pontos não verificados

- `[⏳ ACK]` O banco local contém apenas dados do seed, conforme confirmação do usuário. Recriar esses dados é aceitável; ainda identificar o banco-alvo antes de executar comandos para evitar afetar um ambiente diferente.
- `[⚠️ UNVERIFIED]` `prisma migrate status` falhou porque o PostgreSQL em `localhost:5433` não respondeu; migração e seed ainda não foram aplicados/executados neste ambiente.
- `[⚠️ UNVERIFIED]` Redis/BullMQ e políticas de deploy ainda não existem no repositório; as opções de armazenamento de arquivo e expiração precisam ser verificadas no ambiente-alvo.
- Início da eficiência: timestamp do primeiro histórico `RECEBIDO`; fim: primeira transição `TRIAGEM_CONCLUIDA`.
- Previsões e validações preservam frações em colunas `Decimal`; arredondar somente na apresentação.

## Exclusões acordadas

- Webhook, front-end e alta disponibilidade/múltiplos workers não fazem parte da entrega inicial.
- Lucro líquido e Kaplan-Meier ficam fora do escopo; a entrega reportará recuperação bruta e limitações de sobrevivência do OLS.

---
### 🔍 Assumption Lifecycle Legend:
- `[⚠️ UNVERIFIED]`: contrato externo ou estado de ambiente sem evidência conclusiva; verificar antes de depender dele.
- `[⏳ ACK]`: premissa assumida para avançar; revisar se surgirem evidências novas.
