# Planejamento da AV3: MVP até a versão final

## Objetivo

Entregar primeiro um fluxo pequeno que possa ser demonstrado com dados do Prisma: registrar a operação, calcular e persistir análises úteis e consultá-las. Depois, completar a integração para parceiros e o processamento assíncrono pedidos no enunciado.

## Leitura do Prisma atual

O schema já tem uma separação útil em quatro partes:

1. **Dados operacionais:** `Lote`, `Equipamento`, `Movimentacao`, `Usuario` e demais entidades AV1/AV2.
2. **Históricos temporais:** `HistoricoStatusLote` e `HistoricoEstadoFisico` guardam transições e seus responsáveis. Serviços usam `PrismaUnitOfWork`, com isolamento `Serializable`, para salvar a entidade, histórico e journal na mesma transação.
3. **Resultados analíticos:** `ExecucaoAnalise` identifica uma execução e sua versão; `ResultadoAnalise` guarda métricas agregadas; `PrevisaoVidaUtil` e `ValidacaoPrevisao` guardam previsões e erros observados.
4. **Integração futura:** `ParceiroApi`, `ChaveApi` e `SolicitacaoRelatorio` já descrevem identidade, escopos, idempotência e estado de relatório. Ainda não há serviço, rota pública ou fila que use esses modelos.

O banco contém apenas a estrutura. No código atual não encontrei usos de `execucaoAnalise`, `resultadoAnalise`, `previsaoVidaUtil`, `validacaoPrevisao`, `parceiroApi`, `chaveApi` ou `solicitacaoRelatorio`. Os relatórios existentes são síncronos e internos.

### Regras importantes já representadas

- O lote começa em `RECEBIDO`; a criação grava histórico com `statusAnterior = null`. Cada avanço grava uma nova linha e o responsável.
- O estado físico inicial do equipamento também entra no histórico. A entidade mantém a ordem canônica e exige justificativa quando a queda é de duas ou mais categorias.
- Valores de recuperação ficam no equipamento, com datas separadas para estimativa e realização. O schema não liga o valor realizado a um documento comprobatório.
- A previsão guarda metodologia, amostras, parâmetros e R². Hoje `vidaUtilEstimadaMeses` e os campos de validação são inteiros; uma regressão produz naturalmente valores fracionários.
- Os escopos de API são enums, e o hash da chave é único. A chave em texto simples não deve ser persistida.
- A solicitação de relatório tem chave de idempotência única por parceiro e status em Postgres; BullMQ/Redis devem cuidar apenas da execução.

## Decisões e riscos a resolver antes de codificar análises

1. **Eficiência:** usar o timestamp da transição inicial `RECEBIDO` até a primeira `TRIAGEM_CONCLUIDA`, conforme [regras analíticas](regras-analiticas-av3.md); medir por lote, nunca cruzar eventos. O relatório informa que o total inclui espera. Atribuição ao operador é o responsável pela conclusão.
2. **Recuperação:** usar o rótulo “recuperação bruta”. Só aceitar valor realizado com data. Estimar por tipo + estado conhecido na data + marca + modelo; fallback para tipo + estado; sem amostra, sem estimativa. Incluir amostras e a origem demonstrativa do seed. Definir como persistir referência do comprovante antes de tratar valores como auditáveis.
3. **Previsão:** manter `ORDEM_ESTADO` como fonte da escala. Ajustar regressão apenas com eventos até a data de corte; exigir cinco equipamentos com falha; tratar variância zero, inclinação não positiva e previsão fora do intervalo como “sem previsão válida”. Medir vida desde `Lote.dataEntrada`, reportar sobreviventes e viés de sobrevivência.
4. **Precisão de meses:** decidir se previsões e erros devem aceitar frações (Decimal) ou se o relatório arredondará de forma explícita. Não arredondar em passos intermediários.
5. **Migrações:** a primeira migração AV3 contém avisos de perda ao trocar `Movimentacao.responsavel`, `origem` e `destino`. Antes de aplicar em banco com dados, criar uma migração de conversão que preserve os valores e validar backup/rollback. Não editar migrações já aplicadas; mudanças de schema devem gerar migrações novas.
6. **Integridade:** `SolicitacaoRelatorio` permite parceiro e usuário ambos nulos ou ambos preenchidos; se cada solicitação deve ter exatamente um solicitante, impor isso no serviço e considerar uma constraint SQL. A idempotência por dois campos nullable funciona para múltiplos nulos em PostgreSQL.

## Fases propostas

### Fase 0 — Fechar contrato de dados

- Resolver os cinco pontos acima que afetam o cálculo e a persistência.
- Conferir se a migração AV3 já foi aplicada em bancos com dados e definir estratégia de conversão.
- Ajustar comentários do schema para refletir as regras finais; comentários atuais descrevem marcos de início diferentes.
- Confirmar que o seed tem trajetórias com falhas, sobreviventes e variância temporal. Marcar valores fictícios como demonstração.

**Saída:** regras estáveis e migrações seguras para os dados de desenvolvimento.

### Fase 1 — MVP analítico demonstrável

- Implementar serviço de eficiência sobre históricos existentes: duração por lote, média, concluídos, pendentes e agrupamento por mês/operador.
- Implementar recuperação bruta com valores realizados válidos e contagem de amostras; estimativa híbrida no ponto do fluxo definido como triagem.
- Implementar OLS por tipo de equipamento, corte temporal, critérios de insuficiência e persistência de previsão.
- Persistir cada execução em `ExecucaoAnalise` e `ResultadoAnalise`; associar previsões à execução.
- Expor rotas internas autenticadas para executar/consultar análises e previsões históricas. Manter síncrono enquanto o volume de demonstração for pequeno.
- Documentar as limitações estatísticas e a origem dos dados no Swagger/relatório técnico.

**Critério de aceite:** seed reproduzível gera resultados não vazios; uma execução pode ser consultada depois; o relatório não usa dados posteriores à data de corte; amostras e insuficiências aparecem claramente.

### Fase 2 — Completar e validar análises

- Implementar validação somente com falhas após `dataPrevisao`, gravando idade real e erro absoluto.
- Acrescentar testes unitários para OLS com valores conhecidos e testes de integração para transações, corte temporal, médias e ausência de amostras.
- Melhorar a referência de comprovante e rastreabilidade dos valores realizados.
- Rever índices com consultas reais; os índices temporais atuais cobrem buscas por equipamento/lote e timestamp.

**Critério de aceite:** nenhum equipamento do treino é reutilizado como validação da mesma previsão; recalcular e comparar execuções é possível.

### Fase 3 — MVP da API pública

- Criar gestão administrativa de parceiro e emissão/revogação de chave; exibir a chave crua apenas uma vez e persistir somente hash e prefixo.
- Criar prefixo `/api/v1/public`, pre-handler de autenticação e verificação de escopos.
- Manter rotas de parceiro em `/api/v1/public` e mover rotas de usuário interno/gestão para `/api/v1/internal`; usar chave de parceiro no público e JWT com papéis no interno.
- Migrar rotas internas atuais com aliases para os caminhos legados, handlers compartilhados e prazo de depreciação documentado.
- Versionar contratos públicos e internos de forma independente. Mudanças incompatíveis no contrato de parceiro devem avançar a versão pública.
- Expor primeiro leitura de rastreabilidade e consulta de relatórios concluídos; adicionar escrita de lotes apenas com validação e idempotência.
- Adicionar rate limit por parceiro/chave, respostas de erro estáveis e documentação OpenAPI com exemplos.
- Não reutilizar JWT de usuário para parceiros.

**Critério de aceite:** chaves revogadas falham; escopo insuficiente é negado; limite é isolado por parceiro; chave não aparece em logs nem no banco; rotas públicas e internas têm prefixos e autenticação próprios, sem remoção inesperada dos aliases legados.

### Fase 4 — Relatórios assíncronos e versão final

- Adicionar Redis e BullMQ, worker separado e política explícita de tentativas, backoff e fila de falhas.
- Criar solicitação no Postgres antes de enfileirar; tratar a janela de falha entre commit e publicação com outbox ou rotina de reenvio.
- Atualizar status de forma idempotente e limitar consulta/download ao parceiro dono da solicitação.
- Gerar CSV/JSON, definir expiração e autorização do `resultUrl`; não expor caminho interno do arquivo.
- Adicionar métricas/logs por `solicitacaoId`, retries e tempo de execução.
- Documentar instalação e execução em Windows 10+ e Ubuntu 24.04.03+; verificar Docker/Redis e comandos em ambas as plataformas.

**Critério de aceite:** reinício do worker não perde solicitações; retries não duplicam resultados; parceiro só consulta seus próprios relatórios; instalação limpa segue o guia.

## Ordem recomendada

`Fase 0 → Fase 1 → Fase 2 → Fase 3 → Fase 4`

Essa ordem entrega valor analítico independente da fila e reduz dependências externas no MVP. O risco é a API pública e a fila chegarem mais tarde; para reduzir esse risco, o MVP deve definir desde já contratos de serviço e DTOs independentes dos controllers, e persistir `ExecucaoAnalise`/`SolicitacaoRelatorio` com semântica compatível com processamento posterior.

## Fora do MVP

- Webhook, dashboard e front-end.
- Alta disponibilidade de Redis, múltiplos workers e escala para centenas de parceiros.
- Modelos de sobrevivência como Kaplan-Meier; no MVP, reportar o viés do OLS com falhas observadas.
- Lucro líquido, enquanto custos do processo não forem registrados.

## Questões para confirmar

1. Para a entrega acadêmica, a API pública e a fila serão implementadas como requisitos finais do PDF; webhooks e escala horizontal ficam fora do escopo inicial.
