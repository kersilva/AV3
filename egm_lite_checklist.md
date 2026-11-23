# Checklist de implementação — MVP até a versão final AV3

**Branch:** `av3/entrega`
**Commit inicial:** `0fea8dd chore: versiona client gerado com modelos de análise`
**Estado inicial:** `docs/planejamento-mvp-av3.md` e `docs/regras-analiticas-av3.md` estão não rastreados. Preservar e não incluir em commits sem revisar o diff e confirmar que pertencem a esta tarefa. Usuário confirmou que o banco local contém somente dados do seed; perda desses registros é aceitável e eles podem ser recriados.

## Fase 0 — Contrato de dados e migrações

- [ ] [Schema Prisma](api/prisma/schema.prisma): alinhar comentários às regras analíticas acordadas; rever precisão dos meses previstos/erro e referência de comprovante.
- [ ] [Migração AV3](api/prisma/migrations/20261118020013_camada_analitica_av3/migration.sql): inspecionar transições perigosas em `Movimentacao`; não reescrever migração aplicada. Criar migração nova que preserve valores quando necessário.
- [ ] [Seed](api/prisma/seed.ts) e [dados temporais](api/prisma/seed-data.ts): cobrir falhas, sobreviventes, variação temporal e valores de demonstração para todos os relatórios.
- [ ] [Planejamento](docs/planejamento-mvp-av3.md) e [regras analíticas](docs/regras-analiticas-av3.md): registrar decisões de eficiência, arredondamento, comprovante, insuficiência e validação.
- [ ] Antes de qualquer migração destrutiva, confirmar que o alvo é o banco local de desenvolvimento; como contém somente dados do seed, recriação é permitida e o seed deve ser executado novamente.

## Fase 1 — MVP analítico síncrono

- [ ] Implementar consultas tipadas para histórico de lotes, histórico físico, lotes, equipamentos e valores realizados, respeitando exclusão lógica.
- [ ] Implementar eficiência por lote de `Lote.dataEntrada` até a primeira conclusão, média, contagens, agrupamento por mês e responsável da conclusão.
- [ ] Implementar recuperação bruta com amostras válidas e estimativa por correspondência completa com fallback tipo/estado, usando estado conhecido na data da estimativa.
- [ ] Exportar a ordem canônica de estado de `Equipamento.ts` sem duplicar a lista; implementar regressão OLS com corte temporal, mínimo de falhas e motivos de insuficiência.
- [ ] Persistir `ExecucaoAnalise`, `ResultadoAnalise` e previsões em transações coerentes; expor execução e consulta histórica em rotas internas autenticadas.
- [ ] Atualizar Swagger e documentação técnica com unidades, filtros, amostras, limitações e indicação de dados de demonstração.
- [ ] Adicionar testes unitários e de integração para médias, OLS, limites temporais, dados ausentes, precisão e rollback transacional.

## Fase 2 — Validação e auditabilidade

- [ ] Gravar validações apenas para falhas após `dataPrevisao`, com idade real e erro conforme precisão aprovada.
- [ ] Adicionar referência persistida para documento comprobatório de valor realizado e validar preenchimento/data.
- [ ] Testar que itens de treino não são validados na mesma previsão e que recalcular cria execuções históricas separadas.

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
- `[⚠️ UNVERIFIED]` Redis/BullMQ e políticas de deploy ainda não existem no repositório; as opções de armazenamento de arquivo e expiração precisam ser verificadas no ambiente-alvo.
- `[⏳ ACK]` O início da eficiência seguirá `Lote.dataEntrada` conforme `docs/regras-analiticas-av3.md`; a conclusão é a primeira transição `TRIAGEM_CONCLUIDA`.
- `[⏳ ACK]` Previsões preservarão frações internamente; arredondamento será apenas de apresentação, salvo limitação fundamentada do schema legado.

## Exclusões acordadas

- Webhook, front-end e alta disponibilidade/múltiplos workers não fazem parte da entrega inicial.
- Lucro líquido e Kaplan-Meier ficam fora do escopo; a entrega reportará recuperação bruta e limitações de sobrevivência do OLS.

---
### 🔍 Assumption Lifecycle Legend:
- `[⚠️ UNVERIFIED]`: contrato externo ou estado de ambiente sem evidência conclusiva; verificar antes de depender dele.
- `[⏳ ACK]`: premissa assumida para avançar; revisar se surgirem evidências novas.
