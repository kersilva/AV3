# Onda 4 — Validação integral e fechamento

## Status

Planejada. Deve começar depois das Ondas 1, 2 e 3, quando os testes e as regras de recuperação estiverem implementados.

## Lógica atual

- Build, lint, testes unitários e teste de integração isolado têm comandos próprios.
- `api/scripts/runIntegrationTests.mjs` sobe Compose efêmero, descobre portas, aplica migrações e executa um arquivo de integração explicitamente nomeado.
- O Compose efêmero publica Postgres e Redis em portas aleatórias; Redis usa AOF e volume de teste.
- O runner remove o projeto Compose e o volume no bloco `finally`; um Ctrl+C/interrupção externa pode impedir o `finally`, então o encerramento por sinal ainda deve ser verificado.
- A migração de duração já foi aplicada no banco local. Uma nova migração da Onda 2 deve ser validada primeiro no banco efêmero e depois no banco local conforme as autorizações já dadas.

## Objetivo final

Ter uma sequência reproduzível, adequada para desenvolvimento e CI, que valide a aplicação a partir de uma instalação limpa e não interfira no banco, Redis, containers ou arquivos de desenvolvimento.

## Arquivos previstos

- `api/scripts/runIntegrationTests.mjs` — executar todos os arquivos `*.integration.test.ts`, tratar sinais de interrupção e preservar o código de saída.
- `api/package.json` — scripts de build/test/lint/integration, se forem necessários ajustes.
- `compose.integration.yaml` — Postgres e Redis efêmeros, healthchecks, AOF e volumes exclusivos.
- `api/prisma/migrations/**` e `api/prisma/schema.prisma` — todas as migrações novas devem passar em instalação limpa.
- `api/tests/**` — conjunto final de testes unitários, contrato e integração.
- `docs/planejamento-final-testes-observabilidade-outbox.md` — sincronizar o resumo, critérios concluídos e pendências.
- `README.md` — comandos atuais, variáveis de métricas e política de aliases, incluindo data da publicação quando conhecida.
- `.github/workflows/**` ou pipeline existente — considerar CI apenas se já fizer parte do repositório/escopo; não criar fornecedor ou credenciais por suposição.

## Sequência de validação

1. Conferir `git status` e separar qualquer edição de usuário.
2. Aplicar migrações do início num banco de teste descartável.
3. Rodar build, lint e suíte unitária.
4. Rodar toda a suíte de integração com runner único e execução sequencial.
5. Conferir estado de saída, logs e cleanup após sucesso.
6. Executar uma falha controlada de setup/teste e comprovar cleanup do Compose, volumes e diretório temporário.
7. Confirmar que banco e containers locais de desenvolvimento não foram tocados.
8. Rever README e documentos de cada onda, depois registrar checkpoint de commit.

## Testes automatizados propostos

- **Migração limpa:** banco vazio aplica todas as migrações e o Prisma Client gerado compila.
- **Descoberta da suíte:** runner encontra cada arquivo `*.integration.test.ts` novo sem lista manual incompleta.
- **Teardown em falha:** teste de integração propositalmente falha; o runner ainda remove somente o projeto nomeado, volume Redis e diretório temporário.
- **Interrupção por sinal:** runner recebe SIGINT/SIGTERM e faz cleanup controlado antes de devolver saída de interrupção.
- **Isolamento de configuração:** variáveis de teste apontam para portas/dados gerados; teste recusa explicitamente URL fora do database `_test`.
- **Execução repetida:** rodar a suíte duas vezes sem conflito de portas, CNPJ, `jobId`, nome de relatório ou estado Redis.
- **Compatibilidade de scripts:** comandos documentados no README correspondem aos scripts de `api/package.json`.

## Resultado esperado

- Uma execução isolada valida migrações, build, lint, unidade e integração do projeto final.
- Falhas deixam logs úteis, mas não deixam containers ou volumes próprios ativos.
- Nenhum teste usa ou limpa o banco/Redis de desenvolvimento.
- Documentação e comandos refletem os nomes reais de arquivos e scripts.

## Critério de aceite

- A sequência completa passa duas vezes em ambiente limpo.
- Um teste de falha comprova cleanup, e a inspeção final confirma ausência de recursos do projeto de teste.
- README e plano listam somente o que foi verificado; pendências residuais estão nomeadas.
- Todas as mudanças ficam em commits revisáveis, sem incluir alterações locais preexistentes.

## Registro de testes adicionais durante a implementação

Quando aparecer uma necessidade de teste durante a alteração do código ou do runner, implementar o teste junto da causa e registrar aqui o cenário, o comando, o resultado observado e a correção associada.

- Ainda não há testes adicionais registrados; registrar os casos assim que a implementação desta onda começar.
