import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import type { PedidoPrevisao, ResultadoPrevisao } from '../../lib/tipos-melhorias';
import { ROTULO_TAREFA } from '../../lib/tipos-modelos';
import type { AmostraDataset, Modelo, TreinoModeloResumo } from '../../lib/tipos-modelos';
import { Aviso, Botao, Campo, Cartao, Selecao } from '../../ui';
import { mensagemErro } from '../tinyml/componentes';
import './testar.css';

// Aba "Testar" (rota /app/modelos/:id, aba encaixada pelo A07). Roda uma versão (treino com SUCESSO)
// no servidor, pelo mesmo .tflite INT8 / .joblib que vai para a placa.

const LIMITE_IMAGEM_BYTES = 8 * 1024 * 1024;
const LIMITE_AUDIO_BYTES = 4 * 1024 * 1024;
const AVISO_PLACA = 'Roda no servidor com o mesmo .tflite INT8 que vai para a placa; a latência na placa é outra.';

// Lê o arquivo como base64 puro (sem o prefixo data:).
function arquivoParaBase64(arquivo: File): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onload = () => {
      const texto = String(leitor.result ?? '');
      resolver(texto.slice(texto.indexOf(',') + 1));
    };
    leitor.onerror = () => rejeitar(new Error('Não foi possível ler o arquivo.'));
    leitor.readAsDataURL(arquivo);
  });
}

function formatarPercentual(valor: number): string {
  return `${(valor * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function formatarNumero(valor: number): string {
  return valor.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
}

// "1, 2.5, -3" -> [1, 2.5, -3]. Ponto como separador decimal (a vírgula separa os valores).
function lerValores(texto: string): number[] {
  return texto.split(',').map((bruto, posicao) => {
    const valor = bruto.trim();
    const numero = Number(valor);
    if (valor === '' || !Number.isFinite(numero)) {
      throw new Error(`Valor inválido na posição ${posicao + 1}: "${valor}".`);
    }
    return numero;
  });
}

export function AbaTestar({ modelo, treinos }: { modelo: Modelo; treinos: TreinoModeloResumo[] }) {
  const sucessos = treinos.filter((t) => t.status === 'SUCESSO');
  const padrao = sucessos.find((t) => t.publicado) ?? sucessos[0] ?? null;

  const [versaoId, setVersaoId] = useState<string>(padrao ? String(padrao.id) : '');
  const versao = sucessos.find((t) => String(t.id) === versaoId) ?? padrao;

  const [texto, setTexto] = useState('');
  const [imagem, setImagem] = useState<File | null>(null);
  const [previaImagem, setPreviaImagem] = useState<string | null>(null);
  const [audio, setAudio] = useState<File | null>(null);
  const [previaAudio, setPreviaAudio] = useState<string | null>(null);

  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoPrevisao | null>(null);

  // Atributos esperados vêm do cabeçalho do dataset (a 1ª coluna é o rótulo).
  const precisaAmostra = modelo.tarefa === 'CLASSIFICACAO' || modelo.tarefa === 'REGRESSAO';
  const amostra = useDados<AmostraDataset>(precisaAmostra && modelo.dataset ? `/datasets/${modelo.dataset.id}/amostra` : null);
  const cabecalho = amostra.dados?.formato === 'TABELA' ? amostra.dados.cabecalho : null;
  const atributos = cabecalho ? cabecalho.slice(1) : null;
  const esperados = atributos ? atributos.length : null;

  // Prévias locais dos arquivos; libera a URL anterior ao trocar ou sair da tela.
  useEffect(() => {
    if (!imagem) {
      setPreviaImagem(null);
      return;
    }
    const url = URL.createObjectURL(imagem);
    setPreviaImagem(url);
    return () => URL.revokeObjectURL(url);
  }, [imagem]);

  useEffect(() => {
    if (!audio) {
      setPreviaAudio(null);
      return;
    }
    const url = URL.createObjectURL(audio);
    setPreviaAudio(url);
    return () => URL.revokeObjectURL(url);
  }, [audio]);

  function escolherImagem(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0] ?? null;
    setErro(null);
    if (arquivo && arquivo.size > LIMITE_IMAGEM_BYTES) {
      setErro('Imagem grande demais (máximo 8 MB).');
      setImagem(null);
      return;
    }
    setImagem(arquivo);
  }

  function escolherAudio(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0] ?? null;
    setErro(null);
    if (arquivo && arquivo.size > LIMITE_AUDIO_BYTES) {
      setErro('Áudio grande demais (máximo 4 MB).');
      setAudio(null);
      return;
    }
    setAudio(arquivo);
  }

  // Preenche o campo com a 1ª linha do dataset, sem o rótulo.
  async function usarLinhaDoDataset() {
    if (!modelo.dataset) return;
    setErro(null);
    try {
      const dados = await api.get<AmostraDataset>(`/datasets/${modelo.dataset.id}/amostra`);
      if (dados.formato !== 'TABELA' || dados.linhas.length === 0) {
        throw new Error('O dataset não tem linhas para usar.');
      }
      setTexto(dados.linhas[0].slice(1).join(', '));
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  // Monta o pedido conforme a tarefa. Lança erro com a mensagem para o usuário.
  async function montarPedido(): Promise<PedidoPrevisao> {
    if (modelo.tarefa === 'IMAGEM') {
      if (!imagem) throw new Error('Escolha uma imagem para testar.');
      return { imagemBase64: await arquivoParaBase64(imagem) };
    }
    if (modelo.tarefa === 'AUDIO') {
      if (!audio) throw new Error('Escolha um arquivo .wav para testar.');
      return { audioBase64: await arquivoParaBase64(audio) };
    }
    const valores = lerValores(texto);
    if (esperados !== null && valores.length !== esperados) {
      throw new Error(`Esperados ${esperados} valores (um por atributo); você enviou ${valores.length}.`);
    }
    return { valores };
  }

  async function testar() {
    if (!versao) return;
    setErro(null);
    setResultado(null);
    const pedido = await montarPedido().catch((e: unknown) => {
      setErro(mensagemErro(e));
      return null;
    });
    if (!pedido) return;

    setEnviando(true);
    try {
      setResultado(await api.post<ResultadoPrevisao>(`/treinos-modelo/${versao.id}/prever`, pedido));
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  if (modelo.tarefa === 'CHAT') {
    return (
      <Cartao titulo="Testar modelo">
        <Aviso tipo="info">Modelos de conversa são testados na aba Usar.</Aviso>
      </Cartao>
    );
  }

  if (!versao) {
    return (
      <Cartao titulo="Testar modelo">
        <Aviso tipo="info">Ainda não há treino concluído com sucesso para testar.</Aviso>
      </Cartao>
    );
  }

  const opcoesVersao = sucessos.map((t) => ({
    valor: String(t.id),
    rotulo: `Treino ${t.numero}${t.publicado ? ' (publicado)' : ''}`,
  }));

  return (
    <Cartao titulo="Testar modelo">
      <div className="testar">
        <p className="testar-ajuda">
          Tarefa: {ROTULO_TAREFA[modelo.tarefa]}. Escolha a versão e envie uma entrada para ver a previsão.
        </p>
        <Aviso tipo="info">{AVISO_PLACA}</Aviso>

        <div className="testar-campos">
          <Selecao
            rotulo="Versão"
            valor={String(versao.id)}
            aoMudar={setVersaoId}
            opcoes={opcoesVersao}
            vazio="Selecione"
          />

          {modelo.tarefa === 'IMAGEM' && (
            <label className="campo">
              <span className="campo-rotulo">Imagem (até 8 MB)</span>
              <input className="campo-controle" type="file" accept="image/*" onChange={escolherImagem} />
            </label>
          )}

          {modelo.tarefa === 'AUDIO' && (
            <label className="campo">
              <span className="campo-rotulo">Áudio .wav (até 4 MB)</span>
              <input className="campo-controle" type="file" accept=".wav,audio/wav" onChange={escolherAudio} />
            </label>
          )}

          {(modelo.tarefa === 'CLASSIFICACAO' || modelo.tarefa === 'REGRESSAO') && (
            <Campo rotulo="Valores dos atributos" valor={texto} aoMudar={setTexto} />
          )}
        </div>

        {(modelo.tarefa === 'CLASSIFICACAO' || modelo.tarefa === 'REGRESSAO') && (
          <>
            <p className="testar-ajuda">
              {atributos
                ? `Atributos na ordem do CSV (${esperados}): ${atributos.join(', ')}. Separe os valores por vírgula, com ponto como decimal.`
                : 'Separe os valores dos atributos por vírgula, na ordem do CSV, com ponto como decimal.'}
            </p>
            {modelo.dataset && (
              <div className="testar-acoes">
                <Botao variante="secundario" aoClicar={usarLinhaDoDataset}>
                  Usar uma linha do dataset
                </Botao>
              </div>
            )}
          </>
        )}

        {modelo.tarefa === 'IMAGEM' && previaImagem && (
          <div className="testar-previa">
            <img src={previaImagem} alt="Prévia da imagem enviada" />
          </div>
        )}

        {modelo.tarefa === 'AUDIO' && previaAudio && (
          <audio className="testar-audio" controls src={previaAudio} />
        )}

        <div className="testar-acoes">
          <Botao aoClicar={testar} desabilitado={enviando}>
            {enviando ? 'Testando...' : 'Testar'}
          </Botao>
        </div>

        {erro && <Aviso tipo="erro">{erro}</Aviso>}

        {resultado && (
          <div className="testar-resultado" aria-live="polite">
            {resultado.classe !== undefined && <p className="testar-classe">{resultado.classe}</p>}
            {resultado.classe === undefined && resultado.valor !== undefined && (
              <p className="testar-valor">{formatarNumero(resultado.valor)}</p>
            )}

            {resultado.probabilidades && resultado.probabilidades.length > 0 && (
              <ul className="testar-barras">
                {resultado.probabilidades.map((p) => {
                  const largura = Math.min(100, Math.max(0, p.valor * 100));
                  return (
                    <li key={p.classe} className="testar-barra">
                      <span className="testar-barra-rotulo">{p.classe}</span>
                      <span className="testar-barra-trilho">
                        <span className="testar-barra-preench" style={{ width: `${largura}%` }} />
                      </span>
                      <span className="testar-barra-valor">{formatarPercentual(p.valor)}</span>
                    </li>
                  );
                })}
              </ul>
            )}

            <p className="testar-meta">Latência no servidor: {resultado.latenciaMs} ms</p>

            {resultado.avisos.map((aviso, i) => (
              <Aviso key={i} tipo="info">
                {aviso}
              </Aviso>
            ))}

            <details className="testar-saida-bruta">
              <summary>Saída bruta do modelo</summary>
              <code>{resultado.saidaBruta.join(', ')}</code>
            </details>
          </div>
        )}
      </div>
    </Cartao>
  );
}
