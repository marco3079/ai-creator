# A06 — Testar modelo treinado e uso/custo de LLM

Leia: `docs/plano/CONTRATOS-MELHORIAS.md` §7 e §3 (formato do `/modelos/prever` do trainer), `client/src/lib/tipos-melhorias.ts` (`PedidoPrevisao`, `ResultadoPrevisao`, `ResumoUso`, `PrecosLlm`) e `client/src/lib/tipos-modelos.ts`.

## Arquivos (só estes)
- servidor: `server/src/modules/prever/routes.ts` (novo), `server/src/modules/uso/{routes,registrar,precos}.ts` (novos)
- cliente: `client/src/modules/modelos/AbaTestar.tsx` (novo), `client/src/modules/modelos/testar.css` (novo), `client/src/modules/sistema/Uso.tsx` (novo), `client/src/modules/sistema/uso.css` (novo)
O A07 encaixa a aba "Testar" no `Detalhe.tsx`; o A08 registra a rota `/app/uso`; o A09 chama `registrarUso`.

## Passos
1. `prever/routes.ts`: `POST /treinos-modelo/:id/prever` (zod: exatamente um de `valores` (1..10000 números), `imagemBase64` (≤ 8 MB), `audioBase64` (≤ 4 MB)); valida treino SUCESSO de TINYML/TABULAR; monta `artefatos` (TFLITE → `tflite`, JOBLIB → `joblib`, METRICAS → `metricas`) com caminho absoluto e dentro de `config.dataDir`; repassa ao trainer (timeout 30 s); erro 400 do trainer vira `ErroHttp(400, detail)`; trainer fora → 503 "Serviço de treino indisponível".
2. `uso/precos.ts` (tabela padrão §7 e `precoDe(modelo, personalizados)`), `uso/registrar.ts` (`registrarUso`), `uso/routes.ts` (`GET /uso/resumo`, `GET /uso/precos`, `PUT /uso/precos` ADMIN). `porDia` com todos os dias do período (zeros incluídos); `porAgente` com o nome atual do agente ("Agente removido" se null).
3. `AbaTestar.tsx`: escolher a versão (padrão: publicada, senão o último SUCESSO); conforme a tarefa: IMAGEM → escolher/arrastar imagem (prévia) ; AUDIO → escolher `.wav` (player); demais → campo para colar uma linha de valores separados por vírgula com a contagem esperada (`dataset.colunas` quando houver) e botão "Usar uma linha do dataset" (busca `/datasets/:id/amostra` e preenche com a 1ª linha sem o rótulo). Resultado: classe prevista grande + barras de probabilidade, ou o valor da regressão; latência; avisos. Aviso fixo: "Roda no servidor com o mesmo .tflite INT8 que vai para a placa; a latência na placa é outra."
4. `Uso.tsx` (`/app/uso`): seletor de período (7/30/90 dias), cartões (custo total, execuções, tokens entrada/saída, execuções sem preço), gráfico de custo por dia (`GraficoLinha` com `maximo`/`formatar` em US$), tabela por agente e por modelo; para ADMIN, editor de preços (tabela com padrão e campos de personalização).

## Verificação
- `cd server && npx tsc --noEmit`; `cd client && npx tsc --noEmit && npx vite build` (o encaixe pelo A07/A08 pode ainda não existir: publique a pendência).
- Teste de `precoDe`/cálculo de custo com um script `tsx` temporário (ex.: 1 000 000 entrada + 500 000 saída no `claude-sonnet-5-5` = US$ 7,00). Publique.
