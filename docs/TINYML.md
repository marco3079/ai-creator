# TinyML: classificadores para microcontrolador

Um agente TinyML é um classificador que roda dentro do microcontrolador. Você descreve a entrada (sensor, áudio ou tabela), envia um dataset com exemplos rotulados, treina na plataforma e baixa o `model_data.h`, que é embutido no firmware.

Fluxo completo:

1. Crie um agente TinyML em **Agentes TinyML** e configure a entrada, as classes e a arquitetura.
2. Envie o dataset em **Datasets** (CSV, com o formato descrito abaixo).
3. Na aba **Treino** do agente, escolha o dataset e clique em **Treinar**.
4. Acompanhe o log e as métricas. Ao terminar, baixe o `model.tflite` e o `model_data.h`.
5. Crie um projeto de firmware para a sua placa e use o `model_data.h` (veja abaixo).

## Formato do CSV

A primeira linha é o cabeçalho:

```
rotulo,f0,f1,f2,...,fN
```

Cada linha seguinte é um exemplo: o rótulo (texto, a classe) e N números.

```csv
rotulo,f0,f1,f2,f3,f4,f5
parado,0.01,-0.02,9.81,0.00,0.01,-0.01
parado,0.02,-0.01,9.79,0.01,0.00,0.00
agitando,1.45,-2.10,8.31,0.87,-1.12,0.44
agitando,1.72,-1.95,7.90,0.95,-1.30,0.51
```

Regras:

- O rótulo é obrigatório e não pode ser vazio. As classes são os rótulos distintos do arquivo.
- Todas as linhas precisam ter o mesmo número de colunas do cabeçalho.
- Os valores devem ser números decimais, com ponto como separador.
- Para **série temporal** (`SERIE_TEMPORAL`), cada exemplo é uma janela de amostras. A janela vem achatada, amostra por amostra, canal por canal dentro de cada amostra:

  ```
  rotulo,f0,f1,f2,f3,f4,f5,...
  ```

  Com 3 canais (`ax`, `ay`, `az`) e janela de 2 amostras, as colunas são `ax0, ay0, az0, ax1, ay1, az1`.

- Para **tabela** (`TABELA`), cada coluna numérica é uma feature, sem janela.
- Para **áudio** (`AUDIO`), use as características já extraídas (por exemplo, MFCC) em colunas numéricas. A plataforma não decodifica arquivos de áudio.

A prévia do dataset mostra as primeiras linhas e a contagem de exemplos por classe. Procure equilíbrio entre as classes: uma classe com dez vezes mais exemplos tende a dominar o modelo.

## Configuração do agente

O agente guarda a configuração em `configTinyml`. Os campos são:

| Campo | Valores | Padrão | Observação |
|---|---|---|---|
| `tarefa` | `CLASSIFICACAO` | `CLASSIFICACAO` | Única tarefa suportada |
| `entrada.tipo` | `SERIE_TEMPORAL`, `AUDIO`, `TABELA` | `SERIE_TEMPORAL` | Tipo da entrada |
| `entrada.canais` | inteiro | `3` | Canais por amostra (ex.: acelerômetro = 3) |
| `entrada.janela` | inteiro | `50` | Amostras por exemplo |
| `entrada.frequenciaHz` | número | `50` | Taxa de amostragem usada na captura |
| `classes` | lista de textos | `[]` | Preenchida pelo dataset |
| `arquitetura` | `DENSA`, `CNN1D`, `DS_CNN` | `DENSA` | Veja a seção seguinte |
| `camadas` | 1 a 6 | `2` | Camadas ocultas |
| `neuronios` | 4 a 256 | `32` | Neurônios por camada oculta |
| `epocas` | 1 a 500 | `30` | Épocas de treino |
| `taxaAprendizado` | número | `0.001` | Taxa de aprendizado do otimizador |
| `quantizacao` | `INT8`, `FLOAT32` | `INT8` | Veja a seção de quantização |
| `placaAlvo` | ver [FIRMWARE.md](FIRMWARE.md) | `ESP32` | Placa onde o modelo vai rodar |
| `limiteRamKb` | número | `64` | Limite de memória para o modelo, em KB |
| `limiteFlashKb` | número | `256` | Limite de armazenamento para o modelo, em KB |
| `datasetId` | número ou `null` | `null` | Dataset escolhido |
| `ultimoTreinoId` | número ou `null` | `null` | Último treino com sucesso |

Exemplo de configuração completa:

```json
{
  "tarefa": "CLASSIFICACAO",
  "entrada": { "tipo": "SERIE_TEMPORAL", "canais": 3, "janela": 50, "frequenciaHz": 50 },
  "classes": ["parado", "agitando"],
  "arquitetura": "DENSA",
  "camadas": 2,
  "neuronios": 32,
  "epocas": 30,
  "taxaAprendizado": 0.001,
  "quantizacao": "INT8",
  "placaAlvo": "ESP32",
  "limiteRamKb": 64,
  "limiteFlashKb": 256,
  "datasetId": 3,
  "ultimoTreinoId": null
}
```

## Arquiteturas

- **DENSA**: camadas totalmente conectadas. É a mais leve e a mais rápida. Boa escolha para janelas curtas e features já extraídas, como médias e desvios.
- **CNN1D**: convoluções em uma dimensão ao longo do tempo. Capta padrões locais em séries temporais, com mais custo de memória e de processamento.
- **DS_CNN**: convolução separável em profundidade (depthwise separable). É a opção mais eficiente em CNN para microcontroladores, com menos operações que a CNN1D comum.

Comece com `DENSA`. Passe para `CNN1D` ou `DS_CNN` se a acurácia ficar baixa e o modelo ainda couber no limite de memória.

## Quantização

- **INT8** (padrão): pesos e ativações em inteiros de 8 bits, calibrados com exemplos do próprio dataset. Ocupa cerca de um quarto do espaço do `FLOAT32` e roda mais rápido nos microcontroladores. É a escolha para o firmware.
- **FLOAT32**: sem quantização. Útil para comparar a acurácia com a versão INT8. Costuma não caber em placas pequenas.

Se a acurácia cair muito depois da quantização, aumente o número de exemplos, equilibre as classes ou use uma arquitetura um pouco maior.

## Métricas e resultados

Ao final do treino, o painel mostra:

- **acurácia** de treino e de validação;
- **perda** (quanto menor, melhor);
- **matriz de confusão**, que mostra quais classes o modelo confunde;
- **tamanho do modelo**, em bytes, para comparar com `limiteFlashKb`.

Uma diferença grande entre a acurácia de treino e a de validação indica sobreajuste: reduza `neuronios` ou `camadas`, ou junte mais exemplos.

## Como usar o `model_data.h`

O arquivo gerado tem o formato:

```c
alignas(16) const unsigned char g_model[] = { /* bytes do modelo TFLite */ };
const unsigned int g_model_len = 1234;
```

Para usar no firmware com TensorFlow Lite Micro:

1. Crie o projeto de firmware pela plataforma (ou use o `platformio.ini` da placa) e confirme que a biblioteca `TensorFlowLite_ESP32` ou a equivalente da sua placa está nas dependências.
2. Coloque o `model_data.h` em `include/`. Ao compilar com o agente selecionado, a plataforma faz essa cópia sozinha.
3. Inclua o arquivo e carregue o modelo:

```cpp
#include <Arduino.h>
#include "model_data.h"
#include <tensorflow/lite/micro/micro_interpreter.h>
#include <tensorflow/lite/micro/micro_mutable_op_resolver.h>
#include <tensorflow/lite/schema/schema_generated.h>

namespace {
  constexpr int kTamanhoAreaTensores = 16 * 1024;
  uint8_t areaTensores[kTamanhoAreaTensores];
  tflite::MicroInterpreter* interpretador = nullptr;
  TfLiteTensor* entrada = nullptr;
  TfLiteTensor* saida = nullptr;
}

void iniciarModelo() {
  const tflite::Model* modelo = tflite::GetModel(g_model);
  static tflite::MicroMutableOpResolver<6> resolvedor;
  resolvedor.AddFullyConnected();
  resolvedor.AddRelu();
  resolvedor.AddSoftmax();
  resolvedor.AddQuantize();
  resolvedor.AddDequantize();
  resolvedor.AddReshape();
  static tflite::MicroInterpreter estatico(modelo, resolvedor, areaTensores, kTamanhoAreaTensores);
  interpretador = &estatico;
  interpretador->AllocateTensors();
  entrada = interpretador->input(0);
  saida = interpretador->output(0);
}

// Preencha entrada->data.int8 (ou data.f) com a janela normalizada da mesma forma que no treino.
int classificar() {
  interpretador->Invoke();
  int melhor = 0;
  for (int i = 1; i < saida->dims->data[1]; i++) {
    if (saida->data.int8[i] > saida->data.int8[melhor]) melhor = i;
  }
  return melhor;  // índice na lista "classes" da configuração
}
```

Pontos de atenção:

- A ordem das classes no firmware é a mesma da lista `classes` do agente. O índice `0` é a primeira classe.
- A entrada deve ser normalizada e quantizada da mesma forma que os dados de treino. Use `entrada->params.scale` e `entrada->params.zero_point` para converter os valores reais.
- Os operadores listados no `AddXxx` dependem da arquitetura. Para `CNN1D` e `DS_CNN`, adicione `AddConv2D`, `AddDepthwiseConv2D`, `AddAveragePool2D` e `AddMean` conforme o modelo pedir. Se faltar algum operador, o `AllocateTensors` falha com a mensagem do TFLite Micro.
- Tamanho da área de tensores (`kTamanhoAreaTensores`): aumente se o `AllocateTensors` falhar por falta de memória.

## Limites de memória

Compare o tamanho do `model.tflite` (mostrado no treino) com o `limiteFlashKb` do agente, e a memória de trabalho da placa com `limiteRamKb`. Se o modelo for grande demais para a sua placa, tente:

- reduzir `neuronios` e `camadas`;
- preferir `DENSA` ou `DS_CNN` a `CNN1D`;
- manter `quantizacao` em `INT8`;
- reduzir `entrada.janela`, se a aplicação permitir.
