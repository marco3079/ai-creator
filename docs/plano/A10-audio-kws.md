# A10 — Áudio: palavra-chave (KWS) com dataset de .wav

Leia: `docs/plano/CONTRATOS-MELHORIAS.md` §10, `client/src/lib/tipos-modelos.ts` (já tem `AUDIO`, `SONS`, `entrada.audio`), `docs/plano/CONTRATOS-MODELOS.md` §5 e o código de `trainer/app/modelos/tinyml.py` (IMAGEM é o modelo a seguir).

## Arquivos (só estes)
- trainer: `trainer/app/modelos/audio.py` (novo), `trainer/app/modelos/tinyml.py` (ramo AUDIO), `trainer/tests/test_audio.py` (novo)
- servidor: `server/src/modules/datasets/{arquivos,routes}.ts` (SONS), `server/src/modules/modelos/{padroes,opcoes,esquemas,comum}.ts` (AUDIO)
- cliente: `client/src/modules/tinyml/Datasets.tsx` + `tinyml.css` (upload e amostra de SONS com `<audio>`), `client/src/modules/modelos/{FormularioConfig.tsx, comum.ts}` (seção de áudio, padrões, datasets aceitos)
- exemplo: `exemplos/datasets/gerar_sons.py` + `exemplos/datasets/sons.zip` (gerado)

## Passos
1. `audio.py`: ler WAV com o módulo `wave` (PCM 16 bits, mono ou estéreo→mono), reamostrar para `taxaHz` (interpolação linear com numpy), cortar/completar para `duracaoMs`; `extrair_features_audio` com o micro-frontend (§10; teste no container se o import existe) e fallback log-mel; `gerar_header_features(audio) -> str` (`#define AIC_AUDIO_TAXA_HZ` etc.).
2. `tinyml.py` ramo `AUDIO`: carregar a pasta por classe, extrair features de todos os arquivos, split 80/20 estratificado (seed 42), aumento de dados (deslocamento ±100 ms e ruído) só no treino, DS-CNN 2D pequeno (Conv2D 3×3 + `camadas` × [DepthwiseConv2D + Conv2D 1×1 + BN + ReLU] + GlobalAveragePooling + Dense softmax), Early stopping por `val_accuracy` (como IMAGEM), INT8, artefatos (`model.tflite`, `model_data.h`, `features_audio.h` como HEADER_C, `metricas.json`), matriz de confusão no mesmo laço.
3. Servidor: SONS no upload `.zip` (reaproveite a extração de IMAGENS com extensões `.wav`), amostra `formato:'SONS'`, `GET /datasets/:id/audio`; modelos: tarefa AUDIO aceita só dataset SONS; padrões e arquitetura DS_CNN para AUDIO; zod do `entrada.audio` (taxa 8000..48000, duração 250..2000, janela 10..64, passo 10..40, canaisMel 10..80).
4. Cliente: tipo SONS no "Novo dataset" (explicação: "um .zip com uma pasta por palavra e arquivos .wav de 1 s"); amostra com player por arquivo (blob com token, URLs revogadas); `FormularioConfig.tsx` seção "Áudio" (taxa, duração, janela, passo, canais) para tarefa AUDIO; `comum.ts` padrões e `datasetsAceitos` (AUDIO → só SONS).
5. `gerar_sons.py` (numpy + `wave`): 3 classes `grave` (~300 Hz), `agudo` (~1500 Hz), `silencio` (ruído baixo), 20 arquivos de 1 s a 16 kHz por classe com variação de frequência, volume e início; zip < 2 MB.

## Verificação
- `cd trainer && python -m pytest -q tests/test_audio.py` (sem TF: leitura WAV, reamostragem, header).
- `cd server && npx tsc --noEmit`; `cd client && npx tsc --noEmit && npx vite build`.
- No container do trainer (o A02 está trocando a imagem: espere a nota dele no grupo antes de reconstruir; se precisar, use a imagem atual com `docker compose cp`), rode `executar_tinyml` com `sons.zip` extraído e publique acurácia e tamanho.
