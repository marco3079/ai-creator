---
description: Sincroniza os agentes LLM do AI Creator com a pasta .claude/agents deste projeto
---

Sincroniza os agentes LLM da plataforma AI Creator com `.claude/agents/` deste projeto.

1. Chame `listar_agentes` com `tipo: "LLM"` e guarde a lista (id e slug de cada agente).
2. Para cada agente da lista, chame `exportar_agente_md` com o `id` dele e compare o resultado com o arquivo `.claude/agents/<slug>.md` local:
   - Se o arquivo local não existir, grave o Markdown exportado nesse caminho (crie a pasta se preciso). Conte como "baixado".
   - Se o arquivo local for igual ao exportado, não faça nada.
   - Se o arquivo local existir e for diferente, guarde o caminho como "alterado localmente". Não sobrescreva.
3. Se houver arquivos "alterado localmente", mostre a lista com um resumo das diferenças principais (ex.: prompt, modelo, ferramentas) e pergunte ao usuário quais devem ser enviados. Só envie os que ele confirmar.
4. Para cada arquivo confirmado, leia o conteúdo completo e chame `importar_agente_md` com esse conteúdo. Conte como "enviado".
5. Arquivos `.md` em `.claude/agents/` que não correspondem a nenhum agente da plataforma devem ser apenas listados. Não os apague nem os envie sem o usuário pedir.

Ao final, responda em português com a contagem: baixados, já iguais, alterados localmente (pendentes), enviados e erros, se houver.
