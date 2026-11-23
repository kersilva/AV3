# Checklist de implementação — MVP até a versão final AV3

**Branch:** `av3/entrega`
**Commit inicial:** `0fea8dd chore: versiona client gerado com modelos de análise`
**Estado inicial:** `docs/planejamento-mvp-av3.md` e `docs/regras-analiticas-av3.md` estão não rastreados. Preservar e não incluir em commits sem revisar o diff e confirmar que pertencem a esta tarefa. Usuário confirmou que o banco local contém somente dados do seed; perda desses registros é aceitável e eles podem ser recriados.

## Fase 0 — Contrato de dados e migrações

- [x] [Schema Prisma](api/prisma/schema.prisma): meses previstos/erro usam Decimal; valor realizado tem referência e estimativa guarda contagem e nível de amostra.
- [x] [Migração AV3](api/prisma/migrations/20261123120000_precisao_e_comprovante_analises/migration.sql): migração aditiva para precisão, referência e nível da estimativa. Não reescreve migração aplicada.
- [x] [Seed](api/prisma/seed.ts): cobre seis falhas por tipo, sobreviventes, datas distribuídas, falhas futuras a um corte histórico e valores de demonstração.
- [x] [Planejamento](docs/planejamento-mvp-av3.md) e [regras analíticas](docs/regras-analiticas-av3.md): eficiência começa no evento RECEBIDO; meses fracionários preservados; agrupamento usa responsável da conclusão.
- [x] Banco de desenvolvimento confirmado: PostgreSQL local `localhost:5433`; usuário confirmou que contém apenas seed e autorizou migrações/schema. Migrações AV3 aplicadas sem apagar o volume.

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
- [ ] Teste automatizado de integração para provar separação entre treino e validação e isolamento de execuções históricas; regras de corte têm teste unitário e a API/worker foram exercitados manualmente.

## Fase 3 — API pública

- [x] Implementar gestão administrativa de parceiros e emissão/revogação de chave com exibição única do segredo e armazenamento de hash/prefixo.
- [x] Implementar `/api/v1/public`, autenticação por chave, escopos, rate limit por chave e erros estáveis.
- [x] Implementar endpoints versionados de rastreabilidade, lotes e relatórios, com autorização por escopo e parceiro.
- [x] Aplicar `Idempotency-Key` à criação de lotes e solicitações de relatório; documentar contratos no OpenAPI e README.
- [x] Validar manualmente revogação (401), propriedade de relatório (404), conflito de idempotência (409), replay, isolamento de organização (403) e rate limit separado por chave (429). Testes automatizados de integração continuam recomendados.

## Fase 4 — Processamento assíncrono e entrega final

- [x] Adicionar Redis/BullMQ e worker separado; configurar três tentativas, espera exponencial, lock e retenção de jobs falhos.
- [x] Persistir solicitação antes de publicar job e implementar outbox/reenvio periódico entre Postgres e Redis.
- [x] Tornar o worker idempotente e restringir status/arquivo ao dono.
- [ ] Definir expiração e limpeza automática dos resultados.
- [x] Gerar e entregar JSON sem expor caminhos internos; logs incluem falhas e IDs de solicitação.
- [x] Atualizar Compose e documentação com instruções PowerShell e shell POSIX. Verificação executada em Windows; Ubuntu 24.04.03 não estava disponível.
- [x] Verificar migrações, seed idempotente, build, lint, testes e fluxo API/worker no ambiente Windows. Instalação limpa e Ubuntu continuam sem verificação.

## Revisão e commits

- [x] Preservar os diffs existentes e registrar o baseline antes da implementação.
- [x] Criar commits separados para API pública e fila/versão final; revisar staged diff para não incluir alterações alheias.
- [ ] Fazer revisão Goldfish do checklist antes da implementação e revisão do diff após cada conjunto funcional.

## Verificações empíricas adiadas

- [ ] Confirmar migração com uma cópia de banco contendo valores legados de `Movimentacao`; verificar conversão e rollback.
- [ ] Interromper Redis durante a publicação e comprovar reenvio pela outbox após recuperação.
- [ ] Verificar comandos e dependências em Windows e Ubuntu; este ambiente local só confirma a plataforma em que as verificações forem executadas.

## Riscos de pontos não verificados

- Migrações aplicadas: 16/16. O seed executou duas vezes; a segunda execução concluiu sem duplicar os dados controlados.
- Build, lint e seis testes unitários passaram. API e worker passaram por testes integrados locais.
- `[⚠️ UNVERIFIED]` Ubuntu, instalação limpa, recuperação da outbox com Redis indisponível e expiração dos arquivos não foram verificados ou implementados.
- Início da eficiência: timestamp do primeiro histórico `RECEBIDO`; fim: primeira transição `TRIAGEM_CONCLUIDA`.
- Previsões e validações preservam frações em colunas `Decimal`; arredondar somente na apresentação.

## Exclusões acordadas

- Webhook, front-end e alta disponibilidade/múltiplos workers não fazem parte da entrega inicial.
- Lucro líquido e Kaplan-Meier ficam fora do escopo; a entrega reportará recuperação bruta e limitações de sobrevivência do OLS.

---
### 🔍 Assumption Lifecycle Legend:
- `[⚠️ UNVERIFIED]`: contrato externo ou estado de ambiente sem evidência conclusiva; verificar antes de depender dele.
- `[⏳ ACK]`: premissa assumida para avançar; revisar se surgirem evidências novas.
