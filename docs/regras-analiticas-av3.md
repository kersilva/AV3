# Regras analíticas da AV3

Status: regras acordadas e propostas de implementação registradas. Os pontos que ainda precisam de confirmação estão identificados.

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

### Lacuna de dados

O schema armazena o valor realizado e sua data, mas não guarda a referência do comprovante ou da nota fiscal. A implementação deve definir como identificar esse documento. O relatório pode informar que a conferência foi feita pelo operador, mas isso não substitui uma referência persistida.

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

## 4. Pontos para fechar ou implementar

1. Persistir como a nota fiscal ou o comprovante se relaciona ao valor realizado.
2. Reutilizar a ordem canônica definida em `Equipamento.ts` sem copiar a lista.
3. Tratar uma inclinação nula ou negativa e uma previsão fora do intervalo plausível como resultado sem previsão válida, em vez de publicar um número enganoso.
4. O agrupamento de eficiência por operador atribui o lote ao responsável da conclusão. A duração medida é do lote e inclui espera; ela não mede horas trabalhadas por operador.
