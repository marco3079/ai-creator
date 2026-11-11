---
description: Compila o projeto de firmware da pasta atual no AI Creator e mostra o resultado
argument-hint: "[caminho opcional da pasta do projeto]"
---

Compila no AI Creator o projeto de firmware desta pasta e mostra o resultado.

Pasta do projeto: `$ARGUMENTS` (se vazia, use a pasta atual).

1. Leia o arquivo `.aicreator.json` dentro da pasta do projeto. Ele tem `{ "projetoId": <número>, "slug": "<slug>" }`. Se o arquivo não existir, avise o usuário que o projeto precisa ser baixado pela extensão do VS Code (comando "Baixar projeto") e pare.
2. Chame a ferramenta MCP `compilar_projeto` com `projeto` igual ao `projetoId` lido. Não envie outros argumentos, a menos que o usuário tenha pedido um agente TinyML específico.
3. Se o status for `SUCESSO`, informe que a compilação terminou, o tamanho do firmware e a placa usada (se o resultado trouxer esses dados).
4. Se o status for `FALHA` ou `CANCELADO`, mostre as últimas linhas do log que vieram na resposta e aponte o erro de compilação mais provável (ex.: biblioteca faltando, erro de sintaxe, arquivo com caminho errado). Não altere os arquivos sem o usuário pedir.
5. Se `concluido` for falso (ainda em andamento), chame `status_build` com o `buildId` para verificar de novo e informe o estado.

Responda em português, de forma curta: status, o que deu certo ou errado e o próximo passo.
