# Modelos

Guia da área **Modelos**: como criar, treinar, comparar e publicar modelos, quais formatos de dataset aceitar, e como levar o resultado para o firmware ou para um agente LLM. A lista de rotas está em [API.md](API.md) e a arquitetura dos treinos em [ARQUITETURA.md](ARQUITETURA.md).

## Conceito

Três ideias separam a área:

- **Modelo**: a definição. Tem nome, tipo, tarefa, dataset padrão e configuração. Não depende de agente.
- **Treino**: uma execução do modelo. Cada clique em **Treinar** cria um treino novo, numerado (1, 2, 3...), com os parâmetros usados, o log, as métricas e os artefatos (arquivos gerados).
- **Publicado**: o treino que está em uso. Você compara os treinos e publica um deles. Só um treino por modelo fica publicado.

Quem usa o resultado:

- **Projetos de firmware** embutem um treino publicado de tipo TinyML ou tabular (cabeçalhos `.h` entram em `include/`).
- **Agentes LLM** usam o modelo resultante de um treino de LLM (`modeloResultante`). O botão **Criar agente** do treino monta o agente com esse modelo.

## Os quatro tipos

| Tipo | Tarefas | Quando usar | Datasets aceitos | Saídas |
|---|---|---|---|---|
| **TinyML** | Classificação, regressão, classificação de imagens | Rede neural pequena para rodar em microcontrolador, como gestos com IMU ou imagens de uma ESP32-S3 | CSV (série temporal, tabela ou áudio) e imagens (`.zip`) | `model.tflite`, `model_data.h`, `metricas.json` |
| **Tabular** | Classificação, regressão | Dados tabulares simples, com poucas features, quando uma rede neural seria exagero. Modelos pequenos (árvore, regressão) cabem em qualquer placa | CSV | `modelo.joblib`, `modelo_tabular.h` (quando o algoritmo exporta C), `metricas.json` |
| **LLM na nuvem** | Chat | Ajustar um modelo da OpenAI com exemplos de conversa, para responder do seu jeito | Conversas (`.jsonl`) | Nome do modelo ajustado (`ft:...`) |
| **LLM local** | Chat | Ajustar um modelo pequeno no seu computador, sem enviar dados para a nuvem. Exige GPU NVIDIA | Conversas (`.jsonl`) | Adaptador LoRA e modelo registrado no Ollama |

Tipo e tarefa precisam combinar. TinyML aceita classificação, regressão e imagens. Tabular aceita classificação e regressão. Os dois tipos LLM aceitam apenas chat. Ao criar um modelo, a tela só oferece as combinações válidas.

### Quando escolher TinyML ou tabular

- Dados de sensor em sequência (acelerômetro, temperatura ao longo do tempo) com a classe no fim: **TinyML** com série temporal costuma ser a escolha.
- Uma tabela com colunas numéricas e um alvo: **tabular** é mais simples e treina em segundos. Se o `algoritmo` permitir, o modelo sai como C puro (`modelo_tabular.h`).
- Fotos de objetos ou formas: **TinyML** com tarefa `IMAGEM` (CNN 2D).

### Quando escolher LLM na nuvem ou local

- Na nuvem: mais rápido de treinar e sem GPU, mas os exemplos vão para a OpenAI. Leia a seção [Ajuste fino na OpenAI](#ajuste-fino-na-openai).
- Local: os dados ficam no seu computador, mas exige GPU NVIDIA e mais tempo. Leia [Ajuste fino local](#ajuste-fino-local-gpu-e-ollama).

## Formatos de dataset

Os exemplos abaixo estão no repositório: `exemplos/datasets/gestos.csv` (TinyML, série temporal), `exemplos/datasets/temperatura.csv` (tabular, regressão) e `exemplos/datasets/formas.zip` (TinyML, imagens). Os arquivos `formas.zip` e `temperatura.csv` são gerados pelos scripts do `trainer`.

### CSV (TinyML e tabular)

A primeira coluna é o rótulo. As demais são as features, com cabeçalho `rotulo,f0,f1,...`. Em classificação, o rótulo é texto (a classe). Em regressão, é um número.

Exemplo de classificação (tabular, `Random Forest`):

```csv
rotulo,f0,f1,f2
ligado,0.91,0.12,3.4
desligado,0.08,0.02,0.1
ligado,0.87,0.15,3.1
desligado,0.11,0.05,0.2
```

Exemplo de regressão (tabular, `Regressão linear (Ridge)`): o rótulo é o valor que você quer prever.

```csv
rotulo,f0,f1
21.5,0.42,18
23.1,0.55,21
19.8,0.31,16
```

Para **série temporal** (TinyML), a janela de cada amostra vem achatada, uma amostra depois da outra. Com 3 canais e janela de 25, cada linha tem 75 features: `ax0,ay0,az0,ax1,ay1,az1,...`. O formato completo está em [TINYML.md](TINYML.md). O arquivo `exemplos/datasets/gestos.csv` segue esse formato, com as classes `acenar`, `circulo` e `parado` (100 amostras de cada).

Regra que vale para todo CSV: cabeçalho obrigatório, com `rotulo` na primeira coluna, e as demais colunas com as features.

### Zip de imagens (TinyML, tarefa IMAGEM)

Um `.zip` com uma pasta por classe. Cada pasta tem as imagens da classe. A pasta da classe é o rótulo.

```
formas.zip
  circulo/
    001.jpg
    002.png
  quadrado/
    001.jpg
    ...
  triangulo/
    001.bmp
    ...
```

Regras:

- Extensões aceitas: `jpg`, `jpeg`, `png`, `bmp` e `gif`.
- Pode haver uma pasta raiz única (`formas/circulo/001.jpg`). Ela é desembrulhada automaticamente.
- São ignorados `__MACOSX` e arquivos ocultos.
- Caminhos com `..` são recusados.
- São precisas pelo menos 2 classes e 2 imagens por classe.
- O treino usa 80% das imagens para treinar e 20% para validar. Mais imagens por classe dão um resultado mais estável.

A prévia mostra a quantidade de imagens por classe e até quatro exemplos de cada uma.

### JSONL de conversas (LLM)

Um arquivo `.jsonl` (JSON Lines), UTF-8, com uma conversa por linha. Cada linha é um objeto com a chave `messages`:

```jsonl
{"messages":[{"role":"system","content":"Você é o assistente da oficina."},{"role":"user","content":"Qual o horário de abertura?"},{"role":"assistant","content":"Abrimos de segunda a sexta, das 8h às 18h."}]}
{"messages":[{"role":"user","content":"Vocês fazem troca de óleo?"},{"role":"assistant","content":"Sim, a troca de óleo é feita com hora marcada."}]}
```

Regras:

- Cada conversa precisa de pelo menos uma mensagem `user` e uma `assistant`.
- A última mensagem da conversa precisa ser `assistant`, porque é ela que o modelo aprende a produzir.
- A mensagem `system` é opcional.
- Mínimo de **10 conversas**, exigência da OpenAI.
- Um erro é informado com o número da linha. Corrija a linha e envie de novo.

Se o modelo tiver um **prompt de sistema** na configuração, ele é adicionado como mensagem `system` às conversas que não tiverem uma. Isso acontece sem alterar o arquivo original.

## Fluxo de treino

1. **Crie o modelo** em **Modelos → Novo modelo**. Escolha o tipo, a tarefa e, se quiser, o dataset padrão. Ajuste a configuração na aba **Configuração**.
2. **Envie o dataset** em **Datasets**, ou escolha um já enviado. Os tipos de dataset aceitos dependem do tipo do modelo (tabela acima).
3. **Treine.** Você pode trocar o dataset ou ajustar parâmetros só para este treino. Cada treino recebe um número novo.
4. **Acompanhe** pelo log e pela métrica principal. Em LLM, o log mostra o progresso da OpenAI ou o passo do treino local.
5. **Compare** os treinos na aba **Treinos**. Escolha dois treinos para ver as métricas lado a lado.
6. **Publique** o melhor treino. Ele vira a versão em uso, e o anterior deixa de ser o publicado.
7. **Use o resultado**: embuta no firmware (TinyML e tabular), ou crie um agente (LLM).

Estados de um treino: FILA, EXECUTANDO, SUCESSO, FALHA e CANCELADO. Um treino pode ser cancelado enquanto estiver em FILA ou EXECUTANDO. Se falhar, o log mostra a causa.

Também é possível treinar pelo Claude Code, com o comando `/ai-treinar-modelo` (veja [INTEGRACOES.md](INTEGRACOES.md)).

## Comparação de treinos

Cada tipo mostra uma métrica principal, usada na lista de modelos e na comparação:

| Tipo e tarefa | Métrica principal | Outras métricas |
|---|---|---|
| TinyML classificação ou imagem | Acurácia de validação | Matriz de confusão, histórico por época |
| TinyML regressão | R² | MAE, RMSE, histórico por época |
| Tabular classificação | Acurácia no conjunto de teste | F1 macro, precisão, recall, matriz de confusão, validação cruzada |
| Tabular regressão | R² | MAE, RMSE, validação cruzada |
| LLM na nuvem | Tokens treinados | Histórico de perda, quando a OpenAI informa |
| LLM local | Perda final | Histórico de perda por passo |

Dicas para comparar:

- Compare treinos do **mesmo dataset**. Uma acurácia de 95% em um dataset fácil não diz nada sobre outro.
- Desconfie de acurácia muito alta com pouco dado. Confira a matriz de confusão e a validação cruzada.
- Para TinyML, veja também o tamanho do `.tflite`. O sistema avisa no log se ele passar do limite de flash configurado.

## Levar o modelo para o firmware

Modelos TinyML e tabulares viram cabeçalhos C. O projeto de firmware recebe os arquivos em `include/` quando você escolhe o modelo no seletor **Embutir modelo** da tela do projeto. O grupo **Modelos treinados** lista os treinos publicados.

Só são copiados os arquivos do tipo `HEADER_C`: `model_data.h` (TinyML) e `modelo_tabular.h` (tabular, quando o algoritmo exporta C).

### TinyML: `model_data.h`

O cabeçalho traz o modelo como vetor de bytes, com o nome `g_model`. Use com TensorFlow Lite Micro, como em [TINYML.md](TINYML.md):

```cpp
#include "model_data.h"

// g_model é o vetor de bytes definido em model_data.h
const tflite::Model* modelo = tflite::GetModel(g_model);
```

### TinyML de regressão: normalização

O modelo de regressão é treinado com as features e o rótulo normalizados. Por isso o firmware faz duas conversões, que não são feitas dentro do modelo:

1. Antes de executar o modelo, normalize cada feature: `x_norm = (x - media) / desvio`, com a média e o desvio daquele atributo.
2. Depois de executar, converta a saída: `valor = saida * desvio + media`, com a média e o desvio do rótulo.

Esses números ficam em `metricas.json` do treino, dentro de `normalizacao`. Os valores abaixo são ilustrativos:

```json
"normalizacao": {
  "atributos": { "media": [0.42, 18.0, 1.3], "desvio": [0.15, 4.2, 0.6] },
  "rotulo": { "media": 21.4, "desvio": 2.7 }
}
```

- `atributos.media` e `atributos.desvio` são listas com um valor por feature, na mesma ordem das colunas do CSV.
- `rotulo.media` e `rotulo.desvio` são os do rótulo.
- Se o desvio de um atributo era zero no treino, o sistema usou 1 no lugar. É esse valor que aparece no arquivo.

Exemplo em C, com os números copiados do `metricas.json` do treino publicado:

```c
// média e desvio de cada atributo: metricas.json -> normalizacao.atributos
static const float ATRIB_MEDIA[N_ATRIBUTOS]  = { 0.42f, 18.0f, 1.3f };
static const float ATRIB_DESVIO[N_ATRIBUTOS] = { 0.15f, 4.2f, 0.6f };
// média e desvio do rótulo: metricas.json -> normalizacao.rotulo
#define ROTULO_MEDIA  21.4f
#define ROTULO_DESVIO 2.7f

float entrada[N_ATRIBUTOS];
for (int i = 0; i < N_ATRIBUTOS; i++) {
  entrada[i] = (leitura[i] - ATRIB_MEDIA[i]) / ATRIB_DESVIO[i];   // x_norm
}
// ... executar o modelo com 'entrada' e ler a saída normalizada em 'saida_norm' ...
float valor = saida_norm * ROTULO_DESVIO + ROTULO_MEDIA;          // valor real previsto
```

`N_ATRIBUTOS` é o número de features do treino (em série temporal, canais vezes janela). `leitura` são os valores crus do sensor, na mesma ordem.

### Tabular: `modelo_tabular.h`

O cabeçalho exporta a função `aic_prever`. Ela recebe as features em um vetor de `double` e devolve a saída. Em classificação, o vetor `aic_classes[]` diz o nome de cada índice. O cabeçalho também traz um comentário com a ordem das features.

```cpp
#include "modelo_tabular.h"

double x[AIC_N_FEATURES] = {0.91, 0.12, 3.4};   // valores crus, na ordem das colunas do CSV: f0, f1, f2
double saida[AIC_N_SAIDAS];

aic_prever(x, saida);   // escreve AIC_N_SAIDAS valores

#if AIC_N_SAIDAS == 1
  // Binário com escore bruto: > 0 é aic_classes[1]
  int melhor = saida[0] > 0 ? 1 : 0;
#else
  // Probabilidades (árvores, florestas e multiclasse): vence o maior valor
  int melhor = 0;
  for (int i = 1; i < AIC_N_SAIDAS; i++) {
    if (saida[i] > saida[melhor]) melhor = i;
  }
#endif
Serial.println(aic_classes[melhor]);
```

Passe os valores crus: `aic_prever` aplica a normalização do treino internamente (o header expõe `aic_normalizar` só por conveniência).

`aic_prever` escreve `AIC_N_SAIDAS` valores. Quando `AIC_N_SAIDAS` é 1, o único valor é um escore bruto: em classificação binária, `> 0` significa `aic_classes[1]` (regressão logística e SVM linear). Caso contrário, a saída são probabilidades (árvores e florestas, inclusive binárias, e qualquer multiclasse), e vence o índice de maior valor. Em regressão não existem `aic_classes` nem `AIC_N_CLASSES`: `AIC_N_SAIDAS` é 1 e o valor previsto está em `saida[0]`. Nesse caso use `double y; aic_prever(x, &y);`.

Algoritmos que não exportam C (KNN, Gradient Boosting e SVM com kernel RBF) não geram `modelo_tabular.h`; o trainer registra um aviso e segue sem o header. Use o `modelo.joblib` no servidor ou escolha outro algoritmo.

## Ajuste fino na OpenAI

Ajuste fino na nuvem envia suas conversas para a OpenAI, que treina uma cópia do modelo base.

**Como funciona**

1. O servidor envia o `.jsonl` para a OpenAI e cria o job de ajuste fino.
2. Um worker consulta o andamento a cada 30 segundos e acrescenta os eventos ao log.
3. Quando o job termina com sucesso, o treino vira SUCESSO e guarda o nome do modelo, no formato `ft:...`.

**Custos e tempo**

- A cobrança é por tokens treinados, e o preço depende do modelo base. Consulte a tabela de preços da OpenAI antes de treinar. O sistema mostra os tokens treinados como métrica principal.
- O tempo depende do tamanho do dataset e da fila da OpenAI. Os jobs podem levar de minutos a horas.
- Cancelar um treino em EXECUTANDO pede o cancelamento à OpenAI.

**Como usar o modelo ajustado**

Crie um agente pelo botão **Criar agente** do treino publicado, ou use o nome `ft:...` em um agente que use o provedor OpenAI. O sistema usa o prompt de sistema da configuração do modelo.

Necessário: a chave `OPENAI_API_KEY` no `.env`. Sem ela, o treino falha com a mensagem "OPENAI_API_KEY não configurada no servidor (.env)".

## Ajuste fino local (GPU e Ollama)

Ajuste fino local treina um adaptador LoRA sobre um modelo pequeno (Llama 3.2 de 1B ou 3B parâmetros) no serviço `finetuner`. Ao final, o adaptador é registrado no Ollama, e o modelo pode ser usado como agente local.

### Requisitos

- Computador com **GPU NVIDIA** e drivers atualizados.
- **NVIDIA Container Toolkit**, para o Docker acessar a GPU. Sem ele, o contêiner não enxerga a placa.
- Espaço em disco para o modelo base (cache no volume `hf`).

Suba o serviço com:

```bash
docker compose --profile gpu up -d finetuner
```

Para registrar o modelo no Ollama, suba também o Ollama:

```bash
docker compose --profile gpu --profile ollama up -d
```

A tela de criação mostra se o `finetuner` está disponível e se há GPU. Sem o serviço, o treino falha com a mensagem "Serviço finetuner indisponível. Suba com: docker compose --profile gpu up -d finetuner".

### Configuração

- **Modelo base**: `llama3.2:1b` (mais rápido, menos qualidade) ou `llama3.2:3b`.
- **LoRA rank** (`loraRank`) e **alpha** (`loraAlpha`): controlam o tamanho do adaptador. Os padrões (16 e 32) servem para a maioria dos casos.
- **Épocas**, **taxa de aprendizado** e **tamanho do lote**: os padrões funcionam como ponto de partida.
- **Comprimento máximo**: conversas maiores são cortadas. Aumente com cuidado, porque usa mais memória de GPU.
- **Nome no Ollama**: se vazio, o sistema usa `aic-<modelo>-v<numero>`.

### Limitações

- Só funciona com GPU NVIDIA. Não há treino em CPU.
- Modelos maiores que a memória da GPU não treinam. Reduza o comprimento máximo ou o tamanho do lote.
- Se o Ollama não responder ao fim do treino, o treino termina em SUCESSO com um aviso no log e sem nome de modelo. O adaptador continua disponível para baixar.
- Os modelos base são baixados do Hugging Face na primeira vez, o que exige internet.

## Limites e boas práticas

- Use um conjunto de teste separado do de treino. Para TinyML, o sistema já separa uma parte para validar.
- Não treine com dados sensíveis na nuvem sem autorização do responsável pelos dados.
- Versione o dataset junto com o projeto. Trocar o arquivo muda o resultado do treino.
- Guarde a versão publicada. Publicar outro treino não apaga os anteriores.

## Próximos passos

Ideias para a área estão em [SUGESTOES.md](SUGESTOES.md): reconhecimento de palavras-chave por áudio com MFCC, AutoML, rastreamento de experimentos e avaliação de LLM ajustado.
