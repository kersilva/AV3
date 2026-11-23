# Regras analíticas da AV3

Status: regras acordadas e conferidas contra a implementação. As limitações atuais e as melhorias futuras estão no [relatório técnico](relatorio-tecnico-av3.md).

## 1. Eficiência operacional

- Para cada lote concluído, calcular `tempoTotalTriagem = timestamp(TRIAGEM_CONCLUIDA) - timestamp(RECEBIDO)`.
- Usar a linha inicial do lote, identificada por `statusAnterior = null` e `statusNovo = RECEBIDO`, como início.
- Usar a primeira linha com `statusNovo = TRIAGEM_CONCLUIDA` como fim.
- Calcular a média aritmética por lote concluído. Nunca subtrair eventos de lotes diferentes.
- Informar também a quantidade de lotes pendentes. Lotes sem `TRIAGEM_CONCLUIDA` não entram na média.
- Permitir agrupamento por operador e por mês. Proposta operacional: usar o responsável registrado na linha de conclusão e o mês da conclusão.
- Esse tempo é tempo corrido do lote, incluindo espera. O agrupamento pelo responsável da conclusão não mede o tempo de trabalho individual do operador.

## 2. Recuperação média por tipo

- Não chamar o resultado de rentabilidade ou lucro. A métrica é **recuperação bruta**.
- O operador informa o valor realizado no desmonte com base em comprovante de venda ou nota fiscal.
- Na triagem, o sistema calcula `valorEstimadoRecuperacao` pela média de valores realizados de equipamentos com mesmo tipo, estado físico, marca e modelo. Usar o estado físico conhecido na data da estimativa, não o estado atual de um equipamento histórico.
- Se não houver amostras para a combinação completa, usar a média de equipamentos com o mesmo tipo e estado físico.
- Se também não houver amostras para tipo e estado, não gerar estimativa.
- Usar apenas valores realizados válidos, com data de realização. Exibir a quantidade de amostras usada na média.
- Valores fictícios do seed devem ser identificados como dados de demonstração.
- O sistema não calcula lucro líquido, porque não registra custos de processo.

### Evidência e limites

O schema guarda a referência textual do comprovante junto ao valor e à data de realização. A referência permite auditoria, mas não armazena o arquivo da nota ou do comprovante. O sistema também não calcula lucro líquido, porque não registra custos de processo.

## 3. Previsão de vida útil

### Definição

- A vida total em custódia começa em `Lote.dataEntrada`.
- A falha ocorre na primeira linha de `HistoricoEstadoFisico` com `estadoNovo = INSERVIVEL`.
- O tempo restante é `vidaUtilEstimadaMeses - idadeAtualMeses` para equipamentos ainda em uso. Se o resultado for negativo, informar que a idade atual ultrapassou a vida estimada e mostrar o valor calculado com esse sinal.
- Agrupar as previsões por tipo de equipamento.

### Regressão linear simples

- Ajustar uma regressão de mínimos quadrados por tipo de equipamento.
- Para cada observação do histórico físico, usar como `x` a idade em meses desde `Lote.dataEntrada` até o timestamp do evento.
- Usar como `y` a posição do estado físico na ordem canônica: `NOVO = 0` até `INSERVIVEL = 6`.
- Usar observações de equipamentos que falharam e de equipamentos ainda em uso.
- Para uma previsão feita em `dataPrevisao`, usar somente eventos com timestamp até essa data no ajuste. Isso impede que dados futuros entrem no modelo.
- Calcular a vida prevista como a idade `x` em que a reta ajustada atinge `y = 6`.
- Publicar a previsão somente quando houver ao menos cinco equipamentos com falha registrada para o tipo. Abaixo desse limite, informar dados insuficientes e a quantidade disponível.
- Se a variância dos valores `x` for zero, não calcular a regressão; informar dados insuficientes.
- Usar `ORDEM_ESTADO` de `Equipamento.ts` como única fonte da escala. Não duplicar nem inferir a ordem pela declaração do enum.

### Validação e limitações

- Persistir a previsão e sua data em `PrevisaoVidaUtil`.
- Validar apenas com falhas ocorridas depois de `dataPrevisao`. Não usar a mesma falha para treino e validação daquela previsão.
- Para cada validação, comparar a vida prevista com a idade real em meses desde `Lote.dataEntrada`; guardar idade real e erro absoluto.
- Informar quantas falhas foram usadas no ajuste e quantos equipamentos ainda estão em uso.
- A escala de estados é ordinal. A regressão assume que a distância entre níveis é uniforme; essa aproximação deve constar no relatório técnico.
- Uma trajetória com datas concentradas pode deixar a variância de `x` em zero. O seed temporal é necessário para exercitar o cálculo.

## 4. Regras conferidas na implementação

1. A referência do comprovante é persistida junto ao valor realizado.
2. O cálculo reutiliza `ORDEM_ESTADO` definida em `Equipamento.ts`.
3. Inclinação não positiva e previsão fora do intervalo plausível são retornadas como modelo inválido.
4. O agrupamento por operador usa o responsável pela conclusão; a duração inclui espera e não representa horas individuais de trabalho.
