import { useState } from 'react';
import { Aviso, Botao, Campo, Cartao } from '../../ui';
import { api } from '../../lib/api';
import { gravarEsp, buscarFirmware, salvarArquivo, suportaWebSerial } from './gravarEsp';
import type { BuildResumo } from '../../lib/tipos-api';

// Gravação do firmware de um build: download, USB (Web Serial), UF2 (RP2040), ou pelo servidor.
export function Gravador({ build }: { build: BuildResumo }) {
  const [baixando, setBaixando] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [porta, setPorta] = useState('');
  const [gravandoServidor, setGravandoServidor] = useState(false);
  const [logServidor, setLogServidor] = useState<string | null>(null);

  const usaWebSerial = build.placa === 'ESP32' || build.placa === 'ESP32S3';
  const nomeArquivo = `firmware-${build.placa.toLowerCase()}-build${build.id}${build.placa === 'RP2040_PICO' ? '.uf2' : '.bin'}`;

  function acrescentarLog(linha: string) {
    setLog((atual) => [...atual, linha]);
  }

  async function baixar() {
    setBaixando(true);
    setErro(null);
    try {
      const bytes = await buscarFirmware(build.id);
      salvarArquivo(bytes, nomeArquivo);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao baixar');
    } finally {
      setBaixando(false);
    }
  }

  async function gravarUsb() {
    setGravando(true);
    setErro(null);
    setSucesso(null);
    setProgresso(0);
    setLog([]);
    try {
      const bytes = await buscarFirmware(build.id);
      // offset vem como texto ("0x0", "0x10000"); Number aceita o prefixo hexadecimal.
      const offset = build.offset ? Number(build.offset) : 0;
      await gravarEsp(bytes, offset, acrescentarLog, setProgresso);
      setSucesso('Firmware gravado com sucesso.');
    } catch (e) {
      const mensagem = e instanceof Error ? e.message : 'Falha na gravação';
      setErro(mensagem);
      acrescentarLog(`Erro: ${mensagem}`);
    } finally {
      setGravando(false);
    }
  }

  async function gravarPeloServidor() {
    setGravandoServidor(true);
    setErro(null);
    setLogServidor(null);
    try {
      const resposta = await api.post<{ ok: boolean; log: string }>(`/builds/${build.id}/gravar`, {
        porta: porta.trim(),
      });
      setLogServidor(resposta.log);
      if (resposta.ok) setSucesso('Firmware gravado pelo servidor.');
      else setErro('O servidor não conseguiu gravar. Veja o log abaixo.');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao gravar pelo servidor');
    } finally {
      setGravandoServidor(false);
    }
  }

  return (
    <div className="firmware-gravador">
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {sucesso && <Aviso tipo="sucesso">{sucesso}</Aviso>}

      <Cartao titulo="Baixar firmware">
        <p className="firmware-texto">
          Arquivo <code>{nomeArquivo}</code> para gravar com a ferramenta que preferir.
        </p>
        <Botao variante="secundario" desabilitado={baixando} aoClicar={baixar}>
          {baixando ? 'Baixando...' : 'Baixar firmware'}
        </Botao>
      </Cartao>

      {usaWebSerial && (
        <Cartao titulo="Gravar via USB">
          {suportaWebSerial() ? (
            <>
              <p className="firmware-texto">
                Conecte a placa por USB, clique no botão e escolha a porta serial no navegador.
              </p>
              <Botao desabilitado={gravando} aoClicar={gravarUsb}>
                {gravando ? 'Gravando...' : 'Gravar via USB (Web Serial)'}
              </Botao>
              {(gravando || progresso > 0) && (
                <div className="firmware-progresso" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progresso}>
                  <div className="firmware-progresso-barra" style={{ width: `${progresso}%` }} />
                  <span>{progresso}%</span>
                </div>
              )}
              {log.length > 0 && <pre className="firmware-log">{log.join('\n')}</pre>}
            </>
          ) : (
            <Aviso tipo="info">
              Seu navegador não tem Web Serial. Use Chrome ou Edge para gravar pelo USB.
            </Aviso>
          )}
        </Cartao>
      )}

      {build.placa === 'RP2040_PICO' && (
        <Cartao titulo="Gravar Raspberry Pi Pico (RP2040)">
          <ol className="firmware-passos">
            <li>Segure o botão BOOTSEL e conecte a placa ao USB.</li>
            <li>Ela aparece como unidade RPI-RP2.</li>
            <li>Arraste o arquivo <code>.uf2</code> baixado para essa unidade.</li>
          </ol>
        </Cartao>
      )}

      {!usaWebSerial && build.placa !== 'RP2040_PICO' && (
        <Cartao titulo="Gravar a placa">
          <p className="firmware-texto">
            Use a extensão do VS Code (Gravar) ou o PlatformIO local para gravar esta placa.
          </p>
        </Cartao>
      )}

      <Cartao titulo="Gravar pelo servidor">
        <p className="firmware-texto">
          Exige que o servidor esteja em Linux com o USB da placa mapeado no container.
        </p>
        <div className="firmware-linha-gravar">
          <Campo rotulo="Porta no servidor" valor={porta} aoMudar={setPorta} />
          <Botao
            variante="secundario"
            desabilitado={gravandoServidor || porta.trim() === ''}
            aoClicar={gravarPeloServidor}
          >
            {gravandoServidor ? 'Gravando...' : 'Gravar pelo servidor'}
          </Botao>
        </div>
        {logServidor && <pre className="firmware-log">{logServidor}</pre>}
      </Cartao>
    </div>
  );
}
