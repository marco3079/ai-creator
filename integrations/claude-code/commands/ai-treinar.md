---
description: Treina um agente TinyML do AI Creator com um dataset e acompanha até o fim
argument-hint: "[nome ou id do agente] [nome ou id do dataset]"
---

Treina um agente TinyML do AI Creator com um dataset.

Pedido do usuário: `$ARGUMENTS`

1. Chame `listar_agentes` com `tipo: "TINYML"` e `listar_datasets`.
2. Identifique o agente e o dataset pelo que o usuário escreveu (nome, slug ou id). Se algum não for encontrado, ou houver mais de um parecido, mostre as opções e pergunte. Não escolha sozinho.
3. Mostre o agente e o dataset escolhidos e peça confirmação curta antes de iniciar o treino (o treino usa a fila do servidor).
4. Com a confirmação, chame `treinar_agente` com `id` (do agente) e `datasetId` (do dataset). Só envie `parametros` se o usuário tiver pedido ajustes (ex.: épocas, neurônios, arquitetura). O resultado traz o id do treino.
5. Acompanhe com `status_treino` usando o id do treino. Repita a consulta com pausa entre elas, até o status ser `SUCESSO` ou `FALHA` (no máximo cerca de 20 consultas).
6. Ao terminar:
   - Em `SUCESSO`, mostre as métricas principais (ex.: acurácia) e lembre que o modelo pode ser usado na compilação de um projeto com `compilar_projeto` (campo `agenteId`).
   - Em `FALHA`, mostre as últimas linhas do log e o erro mais provável.
   - Se ainda estiver em andamento após as consultas, informe o id do treino e o status atual, para o usuário consultar depois.

Responda em português, de forma curta.
