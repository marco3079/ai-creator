# g04 — Cliente: agentes

Leia antes: `docs/plano/CONTRATOS.md` (§3 agentes/llm, §4 inteiro). Use **só** os componentes de `client/src/ui` e o visual do REF (veja como `REF/client/src/modules/cadastros/alunos.tsx` e `fichas.css` montam lista + ficha). Se a base do g02 ainda não existir, aguarde (`BUS wait`) — não crie arquivos fora da sua lista.

## Arquivos que você pode criar/editar (só estes)
- `client/src/modules/agentes/*` (index.tsx, Lista.tsx, Editor.tsx, FormularioLlm.tsx, Playground.tsx, Versoes.tsx, ImportarExportar.tsx, agentes.css)

## Passos
1. `index.tsx` com as rotas do contrato: `/app/agentes` (Lista tipo LLM), `/app/tinyml` (Lista tipo TINYML), `/app/agentes/novo`, `/app/agentes/:id`.
2. `Lista.tsx` (`tipo` por prop): cabeçalho `Pagina` com título "Agentes LLM"/"Agentes TinyML", busca (debounce 300 ms → `GET /agentes?tipo=&busca=`), botões "Novo agente" e "Importar" (este só em LLM). Grade de cartões (não tabela): nome, descrição (2 linhas), selos (provedor/modelo ou placa-alvo/arquitetura), tags, versão, "atualizado há X". `MenuAcoes` por cartão: Abrir, Duplicar, Exportar `.md` (LLM), Excluir (confirma com `Modal`). LEITOR não vê ações de escrita. Estado vazio com ilustração/ícone e atalho para criar.
3. `Editor.tsx` (novo e edição): `Abas` — LLM: **Configuração**, **Playground**, **Versões**, **Exportar**; TinyML: **Configuração**, **Treino**, **Versões**, **Exportar (JSON)**. Campos comuns: nome, descrição, tags (texto separado por vírgula), projeto vinculado (`GET /projetos`, opcional). Barra fixa no rodapé com "Salvar" + campo "Nota da versão". Salvar novo → `POST /agentes` e navega para `/app/agentes/:id`; edição → `PUT`. Aviso de alterações não salvas ao trocar de aba não é necessário.
4. `FormularioLlm.tsx`: provedor (Selecao ANTHROPIC/OPENAI/OLLAMA, mostra selo "chave não configurada" a partir de `GET /llm/status`), modelo (Selecao com `GET /llm/modelos` + opção "Outro…" que vira Campo livre), para ANTHROPIC: esforço (low…max, padrão high) e **sem** temperatura; para OPENAI/OLLAMA: temperatura (0–2, passo 0.1). maxTokens (opcional). Prompt de sistema em `AreaTexto` grande com fonte monoespaçada e contador de caracteres. Ferramentas: chips com as opções do Claude Code `Read, Write, Edit, Glob, Grep, Bash, WebFetch, WebSearch, Agent` + adicionar livre.
5. Para TinyML importe `FormularioTinyml` e `AbaTreino` de `../tinyml/componentes` (feitos pelo g06, assinaturas no contrato). Não implemente esses componentes.
6. `Playground.tsx`: chat (balões estilo do REF `modules/chat/chat.css` como inspiração, CSS próprio em `agentes.css`), envia com `lerEventos('/agentes/:id/executar', {mensagens})`, mostra texto chegando aos poucos, botão "Parar" (AbortController), uso de tokens no fim, erros em `Aviso`. "Salvar conversa" → `POST /agentes/:id/conversas`; lista lateral de conversas salvas (`GET /agentes/:id/conversas`) para reabrir. Aviso: "Salve o agente antes de testar" quando houver alterações não salvas (compare JSON).
7. `Versoes.tsx`: `Tabela` com versão, nota, data; ação "Ver" (Modal mostrando snapshot formatado em `<pre>`) e "Restaurar" (confirma).
8. `ImportarExportar.tsx`: exportar (`GET /agentes/:id/exportar?formato=md|json`, mostra em `<pre>` com botão "Copiar" e "Baixar" `<slug>.md`) e modal de importar (colar texto ou escolher arquivo `.md/.json` com `FileReader`, `POST /agentes/importar`).
9. Responsivo: abaixo de 900 px os cartões viram 1 coluna e as abas rolam na horizontal.

## Aceite / verificação
- `cd client && npx tsc --noEmit` sem erros (se o g06 ainda não entregou `tinyml/componentes.tsx`, publique isso como pendência e rode de novo quando ele terminar).
- `npx vite build` sem erros.
