# Relatório técnico — GreenCode AV3

**Data:** 23/11/2026

**Escopo:** camada analítica, integração pública e processamento assíncrono.

## 1. Resumo

A AV3 amplia a API do GreenCode com análises persistidas, acesso para parceiros externos e geração assíncrona de relatórios. A aplicação HTTP e o worker são processos Node.js separados. PostgreSQL guarda os dados e o estado de negócio. Redis e BullMQ distribuem o trabalho; a outbox no PostgreSQL permite republicar tarefas depois de falhas.

O front-end não faz parte desta entrega. O contrato para parceiros fica em `/api/v1/public`; as rotas para usuários e gestão ficam em `/api/v1/internal`.

## 2. Arquitetura e tecnologias

- **Node.js e TypeScript:** executam a API e o worker. A separação em módulos de domínio, serviços, controllers e infraestrutura mantém as regras de negócio fora do transporte HTTP.
- **Fastify:** atende as rotas HTTP e fornece os hooks de autenticação, validação, limites de requisição e documentação OpenAPI.
- **Prisma e PostgreSQL:** o Prisma tipa o acesso ao banco e organiza as migrações. O PostgreSQL mantém os registros operacionais, as execuções analíticas e o estado durável dos relatórios.
- **Redis e BullMQ:** distribuem tarefas entre workers e permitem retries. A fila não é a fonte da verdade: o PostgreSQL mantém a solicitação e a outbox.
- **Cálculos estatísticos em TypeScript:** o OLS é implementado diretamente em `AnaliseCalculos.ts`, sem dependência estatística externa. A fórmula é curta, explícita e tem teste unitário com resultado conhecido. Isso permite revisar o cálculo sem depender de uma abstração adicional.
- **Prometheus:** expõe contadores e histogramas de tentativas, duração e resultado do processamento.

## 3. Análises

### Eficiência da triagem

O cálculo mede o tempo entre o primeiro histórico `RECEBIDO` e a primeira conclusão da triagem do mesmo lote. A média inclui o tempo de espera. O relatório também separa os resultados por mês de conclusão e pelo responsável que concluiu a triagem. Lotes sem os dois eventos entram como pendentes e não distorcem a média.

### Recuperação bruta

O sistema registra o valor realizado, a data e uma referência do comprovante depois do desmonte. A análise usa amostras com referência válida e data até o corte solicitado. O relatório apresenta médias por tipo de equipamento. Durante a triagem, a estimativa procura primeiro amostras com o mesmo tipo, estado físico, marca e modelo; se não houver, usa amostras do mesmo tipo e estado. A resposta informa o número de amostras e o nível usado.

O valor é **bruto**. O cálculo não desconta impostos, custos ou outras despesas e, portanto, não representa lucro líquido. O relatório também sinaliza quando as amostras vêm do seed de demonstração.

### Previsão de vida útil

O modelo ajusta uma regressão linear OLS por tipo de equipamento. A idade começa na entrada do lote no sistema. O estado físico é convertido em uma escala ordinal; o modelo assume distância igual entre níveis. Só entram eventos até a data de referência. A previsão requer pelo menos cinco equipamentos que chegaram a `INSERVIVEL` e observações físicas suficientes. Variância zero, inclinação não positiva e valores fora do intervalo permitido são informados como modelo inválido, sem publicar uma previsão.

O relatório separa equipamentos que falharam dos que continuam em uso. A regressão usa falhas observadas, mas os equipamentos ainda em uso são observações censuradas. Isso cria viés de sobrevivência e pode subestimar a vida útil. Kaplan–Meier seria uma evolução estatística adequada, mas não faz parte desta versão.

## 4. Persistência e histórico

As tabelas analíticas têm funções separadas:

- `ExecucaoAnalise` registra tipo de relatório, parâmetros, data de referência e versão do cálculo.
- `ResultadoAnalise` registra uma métrica, sua chave de agrupamento, valor e quantidade de amostras.
- `PrevisaoVidaUtil` guarda a previsão, método, parâmetros do modelo, R² e quantidade de amostras.
- `ValidacaoPrevisao` compara uma previsão com falhas ocorridas depois da data da previsão e guarda a idade real e o erro absoluto.
- `SolicitacaoRelatorio` mantém status, parceiro, parâmetros, tentativas, resultado e duração.
- `OutboxRelatorio` registra a intenção de publicar a solicitação na fila.

Os resultados da execução e as previsões são gravados em transação. A data de referência e a versão do cálculo permitem consultar e interpretar execuções antigas. A validação usa apenas falhas posteriores à previsão para evitar avaliar o modelo com os próprios dados de treino.

## 5. API e segurança

As rotas públicas usam `/api/v1/public` e chave enviada em `x-api-key`. O segredo é mostrado uma vez; o banco guarda seu hash SHA-256, prefixo, escopos e estado de revogação. Cada parceiro está associado a uma organização, e os serviços limitam a consulta aos dados dessa organização. As rotas públicas têm limites de requisição separados por operação e identificam o parceiro pelo hash da chave.

As rotas internas usam `/api/v1/internal`, autenticação JWT e papéis da aplicação. As rotas antigas continuam disponíveis como aliases ocultos na documentação; elas enviam os cabeçalhos `Deprecation` e `Link` apontando para a rota versionada. O caminho contém a versão (`v1`) e o OpenAPI informa a versão do contrato (`1.0.0`).

O Swagger em `/docs` descreve os contratos, os cabeçalhos de autenticação, parâmetros e respostas. O README contém exemplos de uso e preparação local.

## 6. Relatórios assíncronos e recuperação

1. A API valida a chave `Idempotency-Key` e grava a solicitação e a outbox numa transação PostgreSQL.
2. A API tenta publicar o job no Redis e retorna o identificador e a URL de status. Se o Redis estiver indisponível, a solicitação continua gravada como pendente.
3. O worker publica pendências e reconcilia solicitações publicadas sem job ativo. Isso permite recuperar a fila quando Redis ou worker reinicia.
4. Cada job usa o ID da solicitação como `jobId`. O PostgreSQL reivindica o processamento com lease, token e versão de claim, para evitar que um worker antigo confirme uma execução depois de perder a posse.
5. O resultado é gravado em arquivo temporário e renomeado para o nome final. Depois o banco marca a solicitação como concluída. O parceiro consulta o status e baixa apenas o relatório concluído que pertence a ele.

A política atual tenta o job até três vezes, com backoff exponencial de cinco segundos. Jobs com falha ficam retidos para diagnóstico. A outbox e o processamento aceitam entrega *at least once*; a chave estável do job, a transação analítica e a reivindicação no Postgres evitam duplicar o resultado lógico. As métricas e os logs registram resultado, tentativa e duração.

## 7. Validação executada

A suíte automatizada cobre cálculos unitários, autenticação e namespaces, idempotência, isolamento de parceiro, reinício da API, retries, retomada da outbox após Redis reiniciar, disputa entre workers e interrupções abruptas do worker em três checkpoints duráveis. O runner de integração cria Postgres e Redis efêmeros, aplica as migrações e remove os recursos no final.

No ambiente Windows usado nesta entrega, build e lint passaram; os testes unitários passaram; os sete cenários de integração passaram após ampliar o prazo de espera do teste de crash para acomodar a inicialização variável de subprocessos. O relatório do timeout agora informa o checkpoint esperado e os estados do job e da solicitação.

O projeto declara suporte a Windows 10 ou superior e Ubuntu 24.04.3 ou superior. A validação executada neste ambiente cobre Windows com Docker Desktop; uma execução em Ubuntu ainda é necessária para confirmar essa plataforma empiricamente.

## 8. Limites e evolução

- **Escala de parceiros:** executar mais instâncias HTTP e workers, ajustar concorrência com medições e acompanhar filas, duração, retries e erros. O limite de taxa atual usa armazenamento local do processo; para várias instâncias, deve migrar para um armazenamento compartilhado ou gateway.
- **Arquivos:** os JSON ficam no diretório `REPORTS_DIR`. Uma implantação com workers em máquinas diferentes deve usar volume compartilhado ou armazenamento de objetos e definir uma política de expiração/limpeza.
- **Modelo estatístico:** validar previsões com uma base real maior, comparar métodos e considerar Kaplan–Meier para observações censuradas.
- **Recuperação financeira:** se o objetivo mudar de recuperação bruta para lucro líquido, modelar custos e impostos separadamente e atualizar o contrato do relatório.
- **Operação:** antes de produção, testar Ubuntu, instalar a partir do lockfile em ambiente limpo e definir políticas de backup, retenção, monitoramento e segredos.

## 9. Situação frente ao enunciado

| Parte | Situação |
|---|---|
| Camada analítica com eficiência, recuperação e previsão | Implementada |
| Persistência e consulta histórica | Implementada |
| API de parceiros documentada, versionada e separada da API interna | Implementada |
| Chaves, escopos, rate limit e idempotência | Implementados |
| Fila assíncrona, status, download, retries e outbox recuperável | Implementados e cobertos por integração |
| Relatório técnico com decisões, limitações e plano de escala | Este documento |
| Compatibilidade Ubuntu | Prevista, ainda sem validação empírica neste ambiente |
