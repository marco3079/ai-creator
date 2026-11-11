# m07 — Cliente: lista de modelos, assistente de criação e formulário de configuração

Leia: `CONTRATOS-MODELOS.md` (§1–§4 e §7) e `client/src/lib/tipos-modelos.ts` (tipos prontos, do main). Visual: mesmos componentes de `client/src/ui` e o estilo das telas existentes (veja `client/src/modules/agentes/Lista.tsx` e `client/src/modules/tinyml/componentes.tsx`).

## Arquivos (só estes)
- `client/src/modules/modelos/index.tsx`, `Lista.tsx`, `NovoModelo.tsx`, `FormularioConfig.tsx`, `comum.ts`, `modelos.css`

`Detalhe.tsx` (export `DetalheModelo`) é do m08 — importe-o em `index.tsx` pelo contrato. O ícone `laboratorio` é criado pelo m09 em `ui/icones.tsx`; use o nome.

## Passos
1. `index.tsx`: as 3 rotas do §7.
2. `comum.ts`: `formatarMetrica`, `rotuloTipo`, `iconeTipo` (§7).
3. `Lista.tsx` (`/app/modelos`): `Pagina` "Modelos" com subtítulo "Crie e treine modelos de IA: TinyML para placas, clássicos, e ajuste fino de LLMs." Filtro por tipo (abas/chips: Todos, TinyML, Clássicos, LLM nuvem, LLM local), busca com debounce 300 ms. Grade de cartões: ícone do tipo, nome, tarefa, dataset, selo do último treino (`corStatus`), "v<numero> publicada · <métrica>" quando houver publicado, nº de treinos, atualizado há X. Botão "Novo modelo". `MenuAcoes`: Abrir, Duplicar, Excluir (Modal). LEITOR sem ações de escrita. Estado vazio convidativo com os 4 tipos como atalhos.
4. `NovoModelo.tsx` (`/app/modelos/novo`): assistente em 3 passos com indicador de progresso:
   1) **Tipo** — 4 cartões grandes (de `TIPOS_MODELO`) com descrição; LLM nuvem mostra selo "chave não configurada" e LLM local "serviço offline"/"sem GPU" a partir de `GET /modelos/opcoes`, sem impedir a escolha.
   2) **Tarefa e dados** — tarefa (só as do tipo), nome, descrição, tags, dataset (lista de `GET /datasets` filtrada pelos tipos aceitos; link "Criar dataset" para `/app/datasets`; mostra classes/amostras do escolhido).
   3) **Configuração** — `FormularioConfigModelo` com o padrão do tipo/tarefa (pegue de um `POST`? não: monte o padrão no cliente a partir de uma cópia das regras do §2 em `comum.ts` — `configPadraoCliente(tipo, tarefa)`).
   Botões "Criar" e "Criar e treinar" (este faz `POST /modelos` e depois `POST /modelos/:id/treinar`) → navega para `/app/modelos/:id`.
5. `FormularioConfig.tsx` (assinatura exata do §7), seções por tipo:
   - TINYML: entrada (tipo, canais/janela/frequência, ou largura/altura/cores para IMAGEM), arquitetura (filtrada pela tarefa via `opcoes.tinyml.arquiteturas`), camadas, neurônios, épocas, taxa, lote, quantização, aumento de dados (só IMAGEM), placa-alvo (`PLACAS`), limites RAM/flash.
   - TABULAR: algoritmo (filtrado pela tarefa; selo "exporta C"), hiperparâmetros gerados a partir de `opcoes.tabular.algoritmos[].hiperparametros` (input numérico com min/max, select para `opcao`, checkbox para booleano; ao trocar de algoritmo, resetar para os padrões), fração de teste, k-fold, normalizar, exportar C (desabilitado se o algoritmo não exporta).
   - LLM_NUVEM: modelo base (select com `opcoes.llmNuvem.modelosBase` + "Outro…"), épocas/lote/multiplicador com opção "Automático" (null), sufixo, prompt de sistema. Aviso: "O ajuste fino é cobrado pela OpenAI por token treinado."
   - LLM_LOCAL: modelo base, rank/alpha LoRA, épocas, taxa, lote, comprimento máximo, nome no Ollama (placeholder `aic-<slug>-v<n>`), prompt de sistema. Aviso sobre GPU.
   Tooltips/ajuda curta em cada campo (texto pequeno abaixo).
6. Responsivo abaixo de 900 px.

## Verificação
- `cd client && npx tsc --noEmit && npx vite build` (quando o `Detalhe.tsx` do m08 e o ícone do m09 existirem; até lá publique a pendência).
