import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Aviso, Botao, Cartao, Pagina, Selecao } from '../../ui';
import { ConexaoSerial, suportaSerial } from './serial';
import './coleta.css';

const BAUDS = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];
const BAUD_PADRAO = 115200;
const MAX_LINHAS = 2000;

interface Entrada {
  id: number;
  hora: string; // HH:MM:SS.mmm
  texto: string;
}

function horaAgora(): string {
  const d = new Date();
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

/** Monitor serial da placa: conecta, mostra a saída, envia linhas e baixa o log. */
export function MonitorSerial({ compacto }: { compacto?: boolean }) {
  const [conectada, setConectada] = useState(false);
  const [baud, setBaud] = useState(BAUD_PADRAO);
  const [linhas, setLinhas] = useState<Entrada[]>([]);
  const [comCarimbo, setComCarimbo] = useState(false);
  const [autoRolagem, setAutoRolagem] = useState(true);
  const [envio, setEnvio] = useState('');
  const [comFimLinha, setComFimLinha] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const conexaoRef = useRef<ConexaoSerial | null>(null);
  const pendentes = useRef<Entrada[]>([]);
  const agendado = useRef(false);
  const sequencia = useRef(0);
  const areaRef = useRef<HTMLDivElement | null>(null);

  // Uma conexão por componente; fecha a porta ao sair da tela.
  useEffect(() => {
    const conexao = new ConexaoSerial();
    conexaoRef.current = conexao;
    const pararLinhas = conexao.aoLinha((texto) => {
      sequencia.current += 1;
      pendentes.current.push({ id: sequencia.current, hora: horaAgora(), texto });
      if (!agendado.current) {
        agendado.current = true;
        requestAnimationFrame(() => {
          agendado.current = false;
          const novas = pendentes.current;
          pendentes.current = [];
          setLinhas((atuais) => [...atuais, ...novas].slice(-MAX_LINHAS));
        });
      }
    });
    const pararQueda = conexao.aoFecharInesperado(() => {
      setConectada(false);
      setErro('A porta serial foi desconectada.');
    });
    return () => {
      pararLinhas();
      pararQueda();
      void conexao.fechar();
      conexaoRef.current = null;
    };
  }, []);

  // Auto-rolagem: mantém a última linha visível.
  useEffect(() => {
    if (autoRolagem && areaRef.current) {
      areaRef.current.scrollTop = areaRef.current.scrollHeight;
    }
  }, [linhas, autoRolagem]);

  async function conectar() {
    const conexao = conexaoRef.current;
    if (!conexao) return;
    setErro(null);
    try {
      await conexao.abrir(baud);
      setConectada(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível abrir a porta.');
    }
  }

  async function desconectar() {
    await conexaoRef.current?.fechar();
    setConectada(false);
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const conexao = conexaoRef.current;
    if (!conexao || !conectada || envio === '') return;
    setErro(null);
    try {
      await conexao.escrever(comFimLinha ? envio + '\n' : envio);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível enviar.');
    }
  }

  function limpar() {
    pendentes.current = [];
    setLinhas([]);
  }

  function baixarLog() {
    const texto =
      linhas.map((l) => (comCarimbo ? `[${l.hora}] ${l.texto}` : l.texto)).join('\n') + '\n';
    const url = URL.createObjectURL(new Blob([texto], { type: 'text/plain;charset=utf-8' }));
    const agora = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const link = document.createElement('a');
    link.href = url;
    link.download = `monitor-serial-${agora}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  if (!suportaSerial()) {
    return (
      <Aviso tipo="info">
        O monitor serial usa a Web Serial API, que só existe no Chrome ou no Edge, no computador. Abra
        esta página nesse navegador para conectar a placa por USB.
      </Aviso>
    );
  }

  return (
    <div className={`monitor-serial${compacto ? ' monitor-compacto' : ''}`}>
      <div className="monitor-barra">
        {conectada ? (
          <Botao variante="perigo" aoClicar={desconectar}>
            Desconectar
          </Botao>
        ) : (
          <Botao aoClicar={conectar}>Conectar</Botao>
        )}
        <Selecao
          rotulo="Baud"
          valor={String(baud)}
          aoMudar={(v) => setBaud(Number(v))}
          opcoes={BAUDS.map((b) => ({ valor: String(b), rotulo: String(b) }))}
        />
        <label className="monitor-opcao">
          <input type="checkbox" checked={comCarimbo} onChange={(e) => setComCarimbo(e.target.checked)} />
          Carimbo de hora
        </label>
        <label className="monitor-opcao">
          <input type="checkbox" checked={autoRolagem} onChange={(e) => setAutoRolagem(e.target.checked)} />
          Auto-rolagem
        </label>
        <span className="monitor-estado">
          <span className={`monitor-ponto${conectada ? ' monitor-ponto-on' : ''}`} aria-hidden="true" />
          {conectada ? 'Conectado' : 'Desconectado'}
        </span>
      </div>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <div className="monitor-saida" ref={areaRef} role="log" aria-live="off">
        {linhas.length === 0 && <p className="monitor-vazio">Nenhuma linha recebida ainda.</p>}
        {linhas.map((l) => (
          <div key={l.id} className="monitor-linha">
            {comCarimbo && <span className="monitor-hora">{l.hora} </span>}
            {l.texto}
          </div>
        ))}
      </div>

      <form className="monitor-envio" onSubmit={enviar}>
        <input
          className="campo-controle"
          type="text"
          value={envio}
          placeholder="Texto para enviar à placa"
          onChange={(e) => setEnvio(e.target.value)}
          disabled={!conectada}
        />
        <label className="monitor-opcao">
          <input type="checkbox" checked={comFimLinha} onChange={(e) => setComFimLinha(e.target.checked)} />
          Enviar \n
        </label>
        <Botao tipo="submit" desabilitado={!conectada || envio === ''}>
          Enviar
        </Botao>
      </form>

      <div className="monitor-acoes">
        <span className="monitor-meta">
          {linhas.length} de no máximo {MAX_LINHAS} linhas
        </span>
        <Botao variante="secundario" aoClicar={limpar} desabilitado={linhas.length === 0}>
          Limpar
        </Botao>
        <Botao variante="secundario" aoClicar={baixarLog} desabilitado={linhas.length === 0}>
          Baixar log (.txt)
        </Botao>
      </div>
    </div>
  );
}

/** Página da rota /app/serial. */
export function MonitorSerialPagina() {
  return (
    <Pagina titulo="Monitor serial">
      <Cartao>
        <MonitorSerial />
      </Cartao>
    </Pagina>
  );
}
