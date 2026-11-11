# g06 — Cliente: TinyML + telas de sistema

Leia antes: `docs/plano/CONTRATOS.md` (§3 datasets/treinos e g01, §4 inteiro). Visual: componentes de `client/src/ui` e estilo do REF (`REF/client/src/modules/cadastros/usuarios.tsx`, `REF/client/src/modules/logs/*`, `REF/client/src/modules/configuracoes/*` são boas bases para as telas de sistema). Se a base do g02 ainda não existir, aguarde.

## Arquivos que você pode criar/editar (só estes)
- `client/src/modules/tinyml/*` (index.tsx, componentes.tsx, Datasets.tsx, MatrizConfusao.tsx, tinyml.css)
- `client/src/modules/sistema/*` (index.tsx, Usuarios.tsx, Logs.tsx, Configuracoes.tsx, Tokens.tsx, Integracoes.tsx, sistema.css)

## Passos — tinyml
1. `componentes.tsx` com as **assinaturas exatas** do contrato:
   - `FormularioTinyml`: seções "Entrada" (tipo, canais, janela, frequência), "Classes" (chips editáveis), "Modelo" (arquitetura com descrição curta de cada, camadas, neurônios, épocas, taxa de aprendizado, quantização), "Placa-alvo" (Selecao com `PLACAS`, limites de RAM/flash). Mostra estimativa simples de parâmetros (`entrada × neurônios + neurônios² × (camadas-1) + neurônios × classes`) e de tamanho (`parâmetros × (INT8 ? 1 : 4)` bytes) com alerta se passar de `limiteFlashKb`.
   - `AbaTreino`: escolher dataset (`GET /datasets`, mostra amostras/classes; alerta se as classes do dataset diferem das do agente com botão "Usar classes do dataset" que só altera o formulário via evento — aqui basta mostrar o alerta), botão "Treinar" (`POST /agentes/:id/treinar`), lista de treinos (`GET /treinos?agenteId=`) com polling a cada 3 s enquanto houver FILA/EXECUTANDO, detalhe do treino selecionado: status, log em `<pre>` rolável (auto-scroll), métricas (acurácia, val., perda), `MatrizConfusao`, tamanho do modelo e downloads `.tflite` / `model_data.h` (baixe com `fetch` + token e `URL.createObjectURL`, pois a rota exige autenticação).
2. `MatrizConfusao.tsx`: grade colorida (intensidade pela proporção da linha) com rótulos.
3. `Datasets.tsx` (rota `/app/datasets`): Tabela (nome, tipo, classes como selos, amostras, colunas, data) + "Novo dataset" (Modal: nome, descrição, tipo, janela, arquivo `.csv` via FileReader ou colar texto, prévia das 5 primeiras linhas antes de enviar) + ações Ver amostra (Modal com tabela de `/datasets/:id/amostra`), Baixar CSV, Excluir. Bloco de ajuda explicando o formato do CSV (`rotulo,f0,f1,...`).
4. `index.tsx`: rota `/app/datasets`.

## Passos — sistema
5. `Tokens.tsx` (`/app/tokens`): lista os tokens do usuário, "Gerar token" (nome) → Modal mostra o token **uma vez** com botão Copiar e aviso; revogar.
6. `Integracoes.tsx` (`/app/integracoes`): duas colunas/cartões:
   - **VS Code**: passos — instalar a extensão (`.vsix` em `extensions/vscode`, comando `code --install-extension ai-creator-<versao>.vsix`), configurar URL (mostrar `window.location.origin`) e token (link para Tokens), o que dá para fazer (árvore de agentes/projetos, baixar/enviar, compilar, gravar local via PlatformIO).
   - **Claude Code**: comando `claude mcp add ai-creator --env AI_CREATOR_URL=<origin> --env AI_CREATOR_TOKEN=<token> -- node <caminho>/integrations/claude-code/mcp-server/dist/index.js`, e a alternativa por plugin (`/plugin marketplace add marco3079/ai-creator` e `/plugin install ai-creator`). Lista das ferramentas MCP (listar_agentes, ler_agente, salvar_agente, exportar_agente_md, listar_projetos, ler_arquivo, escrever_arquivo, compilar_projeto, status_build, treinar_agente, status_treino). Blocos de código com botão Copiar.
7. `Usuarios.tsx` (`/app/usuarios`, só ADMIN): Tabela + Modal criar/editar (nome, email, senha, perfil, ativo) + excluir.
8. `Logs.tsx` (`/app/logs`, só ADMIN): Tabela com filtro de texto local.
9. `Configuracoes.tsx` (`/app/configuracoes`, só ADMIN): nome, slogan, cor primária (`input type=color`) → `PUT /plataforma`, e quadro "Status dos serviços": `GET /llm/status` (Anthropic/OpenAI/Ollama) com selos.
10. `index.tsx` do sistema com as rotas do contrato (perfis corretos).

## Aceite / verificação
- `cd client && npx tsc --noEmit && npx vite build` sem erros.
