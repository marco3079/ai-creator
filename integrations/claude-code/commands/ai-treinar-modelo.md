---
description: Treina um modelo do AI Creator (TinyML, tabular ou LLM) com um dataset e acompanha até o fim
argument-hint: "[nome ou id do modelo] [nome ou id do dataset]"
---

Treina um modelo do AI Creator com um dataset.

Pedido do usuário: `$ARGUMENTS`

1. Chame `listar_modelos` e `listar_datasets`.
2. Identifique o modelo e o dataset pelo que o usuário escreveu (nome, slug ou id). Se o usuário não citou nenhum modelo, ofereça as opções ou pergunte se ele quer criar um novo.
   - Para criar um modelo, chame `criar_modelo` com `nome`, `tipo` (TINYML, TABULAR, LLM_NUVEM ou LLM_LOCAL) e `tarefa` (CLASSIFICACAO, REGRESSAO, IMAGEM ou CHAT), com a confirmação do usuário. Tipo e tarefa precisam ser compatíveis: TINYML aceita CLASSIFICACAO, REGRESSAO e IMAGEM; TABULAR aceita CLASSIFICACAO e REGRESSAO; LLM_NUVEM e LLM_LOCAL aceitam CHAT.
   - Se algum item não for encontrado, ou houver mais de um parecido, mostre as opções e pergunte. Não escolha sozinho.
3. Mostre o modelo e o dataset escolhidos (com o tipo do modelo e o tipo do dataset) e peça confirmação curta antes de iniciar o treino. Avise que o treino de LLM_NUVEM usa a conta da OpenAI e que o de LLM_LOCAL precisa da GPU do serviço `finetuner`.
4. Com a confirmação, chame `treinar_modelo` com `modelo` (id ou slug) e `datasetId`. Só envie `parametros` se o usuário tiver pedido ajustes (ex.: épocas, neurônios, arquitetura, `n_estimators`, `loraRank`). O resultado traz o id do treino.
5. Acompanhe com `status_treino_modelo` usando o id do treino. Repita a consulta com pausa entre elas, até o status ser `SUCESSO`, `FALHA` ou `CANCELADO` (no máximo cerca de 20 consultas).
6. Ao terminar:
   - Em `SUCESSO`, mostre a métrica principal (`metricaPrincipal`, ex.: acurácia de validação, R², perda ou tokens treinados). Se houver `modeloResultante` (LLM), informe o nome do modelo. Lembre que o treino precisa ser publicado na interface para virar a versão em uso. Um modelo TINYML ou TABULAR publicado pode ser embutido no firmware pelo seletor "Embutir modelo" da tela do projeto.
   - Em `FALHA`, mostre as últimas linhas do log e o erro mais provável.
   - Se ainda estiver em andamento após as consultas, informe o id do treino e o status atual, para o usuário consultar depois com `status_treino_modelo`.

Responda em português, de forma curta.
