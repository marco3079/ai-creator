import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import type { ProjetoResumo } from '../../lib/tipos-api';
import type { Modelo, TreinoModeloResumo } from '../../lib/tipos-modelos';
import { Aviso, Botao, Cartao, Selecao } from '../../ui';
import { mensagemErro } from '../tinyml/componentes';

// Como usar a versão publicada (ou outro treino concluído) de cada tipo de modelo.

const EXEMPLO_CPP = `#include <math.h>      // lroundf
#include <stdint.h>    // int8_t
#include "model_data.h"   // gerado pelo AIC (variável g_model)
#include "tensorflow/lite/micro/micro_interpreter.h"
#include "tensorflow/lite/micro/micro_mutable_op_resolver.h"
#include "tensorflow/lite/schema/schema_generated.h"

constexpr int kTamanhoArena = 32 * 1024;   // ajuste conforme a RAM da placa
uint8_t arena[kTamanhoArena];

const tflite::Model* modelo = nullptr;
tflite::MicroInterpreter* interpretador = nullptr;
TfLiteTensor* entrada = nullptr;
TfLiteTensor* saida = nullptr;

void iniciarModelo() {
  modelo = tflite::GetModel(g_model);
  // Registre as operações que o modelo usa (ex.: FullyConnected, Conv2D, Softmax).
  static tflite::MicroMutableOpResolver<4> resolvedor;
  resolvedor.AddFullyConnected();
  resolvedor.AddSoftmax();
  resolvedor.AddReshape();
  resolvedor.AddQuantize();
  static tflite::MicroInterpreter estatico(modelo, resolvedor, arena, kTamanhoArena);
  interpretador = &estatico;
  interpretador->AllocateTensors();
  entrada = interpretador->input(0);
  saida = interpretador->output(0);
}

// Converte a janela de float para o tensor int8 usando escala e zero-point do próprio tensor.
void preencherEntrada(const float* amostras, int n) {
  const float escala = entrada->params.scale;
  const int zeroPoint = entrada->params.zero_point;
  for (int i = 0; i < n; i++) {
    int v = (int)lroundf(amostras[i] / escala) + zeroPoint;
    if (v > 127) v = 127;
    if (v < -128) v = -128;
    entrada->data.int8[i] = (int8_t)v;
  }
}

int prever() {
  interpretador->Invoke();
  int melhor = 0;
  for (int i = 1; i < saida->dims->data[saida->dims->size - 1]; i++) {
    if (saida->data.int8[i] > saida->data.int8[melhor]) melhor = i;
  }
  return melhor;   // índice da classe (ordem das classes do treino)
}`;

// Macros do header gerado: AIC_N_FEATURES (entradas), AIC_N_CLASSES (só classificação), AIC_N_SAIDAS, aic_classes[].
// Valores crus: aic_prever já normaliza internamente quando o treino foi normalizado.
const EXEMPLO_C_CLASSIFICACAO = `#include <stdio.h>
#include "modelo_tabular.h"   // gerado pelo AIC

int main(void) {
  // Valores crus, na ordem das colunas do treino (AIC_N_FEATURES).
  double x[AIC_N_FEATURES] = { 0.0 };   // substitua pelas leituras dos sensores
  // AIC_N_SAIDAS diz quantos valores aic_prever escreve.
  double pontuacoes[AIC_N_CLASSES];
  aic_prever(x, pontuacoes);

#if AIC_N_SAIDAS == 1
  // Binário: pontuacoes[0] é o escore bruto; acima de zero é a segunda classe.
  printf("classe: %s\\n", pontuacoes[0] > 0 ? aic_classes[1] : aic_classes[0]);
#else
  // Multiclasse: pontuacoes[i] corresponde a aic_classes[i]; vence o maior valor.
  int melhor = 0;
  for (int i = 1; i < AIC_N_SAIDAS; i++) {
    if (pontuacoes[i] > pontuacoes[melhor]) melhor = i;
  }
  printf("classe: %s\\n", aic_classes[melhor]);
#endif
  return 0;
}`;

const EXEMPLO_C_REGRESSAO = `#include <stdio.h>
#include "modelo_tabular.h"   // gerado pelo AIC

int main(void) {
  // Valores crus, na ordem das colunas do treino (AIC_N_FEATURES).
  double x[AIC_N_FEATURES] = { 0.0 };   // substitua pelas leituras dos sensores
  double y;
  aic_prever(x, &y);
  printf("valor previsto: %f\\n", y);
  return 0;
}`;

const EXEMPLO_PYTHON_TABULAR = `import joblib
import numpy as np

modelo = joblib.load("modelo.joblib")
x = np.array([[0.0, 0.0, 0.0, 0.0]])   # mesma ordem de colunas do treino
print(modelo.predict(x))`;

function BlocoCodigo({ codigo }: { codigo: string }) {
  const [copiado, setCopiado] = useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      // sem permissão de área de transferência: o texto continua selecionável
    }
  }
  return (
    <div className="det-bloco">
      <div className="det-bloco-barra">
        <Botao variante="secundario" aoClicar={copiar}>
          {copiado ? 'Copiado' : 'Copiar'}
        </Botao>
      </div>
      <pre className="det-codigo">
        <code>{codigo}</code>
      </pre>
    </div>
  );
}

export function AbaUsar({
  modelo,
  treinos,
  podeEscrever,
}: {
  modelo: Modelo;
  treinos: TreinoModeloResumo[];
  podeEscrever: boolean;
}) {
  const navegar = useNavigate();
  const concluidos = treinos.filter((t) => t.status === 'SUCESSO');
  const padrao = concluidos.find((t) => t.publicado) ?? concluidos[0];
  const [escolhido, setEscolhido] = useState<string>(padrao ? String(padrao.id) : '');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [projetoEscolhido, setProjetoEscolhido] = useState('');
  const projetos = useDados<ProjetoResumo[]>(modelo.tipo === 'TINYML' ? '/projetos' : null);

  const treino = concluidos.find((t) => String(t.id) === escolhido) ?? null;
  const ehLlm = modelo.tipo === 'LLM_NUVEM' || modelo.tipo === 'LLM_LOCAL';
  const nomeModelo = treino?.modeloResultante ?? 'ft:...';

  if (concluidos.length === 0) {
    return <Aviso tipo="info">Nenhum treino concluído ainda. Treine e publique um treino para usar o modelo.</Aviso>;
  }

  const seletorTreino = (
    <Selecao
      rotulo="Versão"
      valor={escolhido}
      aoMudar={setEscolhido}
      opcoes={concluidos.map((t) => ({
        valor: String(t.id),
        rotulo: `#${t.numero}${t.publicado ? ' (publicado)' : ''}`,
      }))}
    />
  );

  async function criarAgente() {
    if (!treino) return;
    setOcupado(true);
    setErro(null);
    try {
      const agente = await api.post<{ id?: number }>(`/treinos-modelo/${treino.id}/criar-agente`);
      if (agente?.id !== undefined) navegar(`/app/agentes/${agente.id}`);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="det-usar">
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <Cartao titulo="Versão">{seletorTreino}</Cartao>

      {modelo.tipo === 'TINYML' && (
        <>
          <Cartao titulo="Embutir num projeto">
            <p className="det-ajuda">
              No projeto, abra o painel Compilar e escolha o modelo em "Modelos treinados". O firmware usa os
              arquivos HEADER_C do treino (model_data.h).
            </p>
            {projetos.erro && <Aviso tipo="erro">{projetos.erro}</Aviso>}
            {projetos.dados && projetos.dados.length === 0 && (
              <p className="det-ajuda">Nenhum projeto cadastrado.</p>
            )}
            {projetos.dados && projetos.dados.length > 0 && (
              <div className="det-acoes">
                <Selecao
                  rotulo="Projeto"
                  valor={projetoEscolhido}
                  aoMudar={setProjetoEscolhido}
                  vazio="Selecione um projeto"
                  opcoes={projetos.dados.map((p) => ({ valor: String(p.id), rotulo: p.nome }))}
                />
                <Botao
                  desabilitado={!projetoEscolhido}
                  aoClicar={() => navegar(`/app/projetos/${projetoEscolhido}`)}
                >
                  Abrir projeto
                </Botao>
              </div>
            )}
          </Cartao>
          <Cartao titulo="Exemplo em C++ (TFLite Micro)">
            <BlocoCodigo codigo={EXEMPLO_CPP} />
          </Cartao>
        </>
      )}

      {modelo.tipo === 'TABULAR' && (
        <>
          <Cartao titulo="Exemplo em C">
            <p className="det-ajuda">Use o header modelo_tabular.h gerado pelo treino (quando exportado).</p>
            <BlocoCodigo codigo={modelo.tarefa === 'REGRESSAO' ? EXEMPLO_C_REGRESSAO : EXEMPLO_C_CLASSIFICACAO} />
          </Cartao>
          <Cartao titulo="Exemplo em Python">
            <p className="det-ajuda">Carrega o modelo.joblib do treino com scikit-learn.</p>
            <BlocoCodigo codigo={EXEMPLO_PYTHON_TABULAR} />
          </Cartao>
        </>
      )}

      {ehLlm && (
        <Cartao titulo="Usar o modelo">
          {podeEscrever && (
            <div className="det-acoes">
              <Botao
                desabilitado={ocupado || !treino?.modeloResultante}
                aoClicar={criarAgente}
              >
                {ocupado ? 'Criando...' : 'Criar agente com este modelo'}
              </Botao>
            </div>
          )}
          {!treino?.modeloResultante && (
            <p className="det-ajuda">Esta versão ainda não tem um modelo registrado.</p>
          )}
          {modelo.tipo === 'LLM_NUVEM' && (
            <>
              <p className="det-ajuda">Chamada pela API da OpenAI:</p>
              <BlocoCodigo
                codigo={`from openai import OpenAI\n\ncliente = OpenAI()\nresposta = cliente.chat.completions.create(\n    model="${nomeModelo}",\n    messages=[{"role": "user", "content": "Olá"}],\n)\nprint(resposta.choices[0].message.content)`}
              />
            </>
          )}
          {modelo.tipo === 'LLM_LOCAL' && (
            <>
              <p className="det-ajuda">Pelo Ollama, no servidor:</p>
              <BlocoCodigo codigo={`ollama run ${nomeModelo}`} />
            </>
          )}
        </Cartao>
      )}
    </div>
  );
}
