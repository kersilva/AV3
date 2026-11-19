# Pendências — AV3 (greencode)

Última atualização: 18/11/2026

Coloque este arquivo em `docs/pendencias-av3.md` na raiz do repositório.

---

## Agora (antes do service de triagem)

Itens que quebram build, lint ou seed, ou que a próxima etapa depende.

- [ ] Fazer dois commits separados: um de limpeza de tipagem (lint e build) e outro da camada temporal e analítica. Motivo: histórico limpo para voltar atrás se algo quebrar.
- [ ] Revisar o diff do Codex e confirmar que não entraram `as any` nem `as unknown` novos. Motivo: esses casts passam no build e escondem divergências.
- [ ] Remover o `as StatusRastreamento` de `dados.destino` em `Equipamento.ts` e tipar a entrada com o enum. Motivo: o cast deixa passar valor inválido, e o service de triagem vai usar esse caminho.
- [ ] Restringir `destino` na rota Fastify com `enum: Object.values(StatusRastreamento)`. Motivo: é a primeira barreira contra valor inválido vindo da API.
- [ ] Rodar o seed e confirmar que nenhum equipamento inicial nasce já em `EM_TRIAGEM`. Se nascer, `registrarMovimentacao` lança `ErroValidacao`. Motivo: o seed é a massa de teste da jornada completa pedida na AV2.
- [ ] Testar manualmente um POST de movimentação e um GET do equipamento. Conferir que `origem` é o status atual e que `responsavelId` traz o id do ator. Motivo: confirma a mudança de fonte da `origem`.
- [ ] Fazer o build do web passar, trocando `asChild` por `render` onde aparecer (`grep -r "asChild" web/`). Motivo: build quebrado impede um commit verde.
- [ ] Garantir que `registrarMovimentacao` atualiza `statusRastreamento` e cria a `Movimentacao` na mesma `$transaction`. Motivo: a `origem` depende disso, e é o núcleo do service de triagem.

---

## Depois (não bloqueia a próxima etapa)

- [ ] Decidir o contrato de `responsavel` na API: expor o nome (com join em `Usuario`) ou o id. Atualizar o Swagger conforme a decisão. Pode ser feito junto com a API pública, porque hoje nenhum cliente consome o campo.
- [ ] Definir a regra de `responsavelId` nulo: só para ação do sistema, e ação humana sempre com usuário logado. Decidir ao desenhar o service de triagem; a validação fica no service, não no domínio.
- [ ] Rodar o lint do web (`eslint web/`).
- [ ] Escrever os testes automatizados da jornada completa, pedidos na AV2, e testes unitários do OLS com resultado conhecido.
- [ ] Criar um seed com histórico temporal: datas espalhadas, com status e estado físico em sequência. Precisa existir antes da análise, não antes da triagem.
- [ ] Definir a fonte do valor de recuperação: quando e como preencher `valorEstimadoRecuperacao` e `valorRealizadoRecuperacao`.
- [ ] Definir se a rentabilidade é bruta ou líquida (descontando `aliquotaImposto`), e declarar a escolha no relatório.
- [ ] Criar a ordem canônica de `EstadoFisico` (`ORDEM_ESTADO`) e a validação de justificativa para queda de duas ou mais categorias.

---

## Próximas etapas grandes (ainda não começadas)

1. Service de triagem gravando `HistoricoStatusLote` e `Movimentacao` na mesma `$transaction`.
2. Seed com histórico temporal (ver item acima).
3. Regressão OLS por tipo de equipamento, gravando em `PrevisaoVidaUtil`.
4. Validação das previsões em `ValidacaoPrevisao`, usando só óbitos ocorridos depois de `dataPrevisao`.
5. Análises de eficiência, de rentabilidade e de previsão.
6. API pública: `ParceiroApi`, `ChaveApi` (hash SHA-256, prefixo, escopos), rotas em `/api/v1/public`, rate limit e `Idempotency-Key`.
7. Fila: `SolicitacaoRelatorio`, BullMQ e Redis, worker, endpoint de status e política de retry.
8. Swagger/OpenAPI da API pública, com exemplos e códigos de erro.
9. Front consumindo a API interna (opcional, depois de tudo acima).
10. Relatório técnico, escrito em paralelo com as decisões.

---

## Decisões para registrar no relatório

- Viés de sobrevivência na regressão, e a alternativa de Kaplan-Meier.
- Base de idade: `Lote.dataEntrada` como início da custódia, não o ano de fabricação.
- Rentabilidade bruta ou líquida, e a razão da escolha.
- Conversão entre enums do domínio e do Prisma, feita por mapa no repositório.
- Chave de API guardada como hash, mostrada uma única vez na criação.
- Idempotência por parceiro, com `@@unique([parceiroId, chaveIdempotencia])`.
- Uso de BullMQ e Redis, que vão além de "exclusivamente Node, TypeScript e Prisma". Perguntar ao professor e registrar a resposta.

---

## Ordem sugerida

1. Concluir os itens de "Agora" e fazer os commits.
2. Service de triagem.
3. Seed com histórico temporal.
4. Regressão OLS e validação das previsões.
5. Análises de eficiência e de rentabilidade.
6. API pública, chaves e rate limit.
7. Fila e status de relatórios.
8. Swagger, relatório técnico e front.
