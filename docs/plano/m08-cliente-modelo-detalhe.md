# m08 — Cliente: detalhe do modelo (treinos, comparação, uso)

Leia: `CONTRATOS-MODELOS.md` (§1, §4 "treinos de modelo", §7) e `client/src/lib/tipos-modelos.ts`. Visual: componentes de `client/src/ui`; reaproveite `client/src/modules/tinyml/MatrizConfusao.tsx` (import) e `client/src/layout/GraficoLinha.tsx` (aceita `maximo` e `formatar`).

## Arquivos (só estes)
- `client/src/modules/modelos/Detalhe.tsx` (`export function DetalheModelo()`), `AbaTreinos.tsx`, `DetalheTreino.tsx`, `Comparar.tsx`, `AbaUsar.tsx`, `GraficoHistorico.tsx`, `detalhe.css`

Importa do m07: `FormularioConfigModelo` de `./FormularioConfig` e `formatarMetrica`, `rotuloTipo`, `iconeTipo` de `./comum`.

## Passos
1. `Detalhe.tsx` (`/app/modelos/:id`): cabeçalho com ícone do tipo, nome, selos (tipo, tarefa), dataset, versão publicada; botões "Treinar" (abre Modal: dataset — padrão o do modelo —, e ajustes rápidos: épocas/algoritmo conforme o tipo; envia `POST /modelos/:id/treinar`), "Voltar". `Abas`: **Treinos**, **Comparar**, **Configuração**, **Usar**. Polling de 3 s enquanto algum treino estiver FILA/EXECUTANDO (limpar no unmount; erro de rede não interrompe o polling).
2. `AbaTreinos.tsx`: lista (`Tabela`) com nº, status, métrica principal, tamanho, duração, data, selo "publicado"; clique abre `DetalheTreino`.
3. `DetalheTreino.tsx`: status, log (pre rolável com auto-scroll), métricas em cartões (classificação: acurácia/val/F1/precisão/recall; regressão: R²/MAE/RMSE; LLM: perda/tokens), `GraficoHistorico` (perda e métrica por época, duas linhas, SVG próprio simples, claro/escuro via variáveis CSS), `MatrizConfusao` quando houver, validação cruzada, lista de artefatos com download autenticado (fetch + Bearer → blob), botões **Publicar** (SUCESSO), **Cancelar** (FILA/EXECUTANDO), **Criar agente** (LLM_* com `modeloResultante`; navega para `/app/agentes/:id` do agente criado), e para LLM_LOCAL/NUVEM mostrar `modeloResultante` com botão Copiar. Parâmetros usados em `<details>` com JSON formatado.
4. `Comparar.tsx`: escolhe 2 a 4 treinos SUCESSO (checkboxes) e mostra tabela lado a lado: parâmetros que mudaram (destacados), métricas principais (melhor valor em negrito/verde), tamanho. Para TinyML, indicar se cabe na placa-alvo (`limiteFlashKb`).
5. `AbaUsar.tsx`: por tipo, como usar a versão publicada (ou a escolhida):
   - TINYML: "Embutir num projeto" (Selecao de projeto + botão que leva a `/app/projetos/:id`; texto explicando o seletor "Modelos treinados" do painel Compilar) e trecho C++ de exemplo com TFLite Micro (`#include "model_data.h"`, `tflite::GetModel(g_model)`, arena, `MicroInterpreter`, entrada int8 com escala/zero-point) em bloco de código com Copiar.
   - TABULAR: exemplo C com `#include "modelo_tabular.h"`, `aic_normalizar`, `aic_prever` e `aic_classes`; e exemplo Python com `joblib.load`.
   - LLM_NUVEM/LLM_LOCAL: botão "Criar agente com este modelo"; exemplos de chamada (OpenAI `model: "ft:..."`; Ollama `ollama run <nome>`).
6. LEITOR: sem Treinar/Publicar/Cancelar/Criar agente.

## Verificação
- `cd client && npx tsc --noEmit && npx vite build` (quando m07 e m09 tiverem entregado; até lá publique a pendência).
