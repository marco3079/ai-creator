import { useState } from 'react';
import type { FormEvent } from 'react';
import { AreaTexto, Aviso, Botao, Campo, Carregando, Grade, Modal, Pagina, Selecao, Selo, formatarDataHora } from '../../ui';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { PLACAS } from '../../lib/tipos-api';
import type { Dispositivo, Placa } from '../../lib/tipos-api';
import './firmware.css';

interface FormDispositivo {
  nome: string;
  placa: Placa;
  porta: string;
  notas: string;
}

const FORM_VAZIO: FormDispositivo = { nome: '', placa: 'ESP32', porta: '', notas: '' };

// API opcional do Web Serial (só navegadores Chromium em contexto seguro).
interface PortaSerial {
  getInfo(): { usbVendorId?: number; usbProductId?: number };
}
type NavegadorSerial = Navigator & { serial?: { requestPort(): Promise<PortaSerial> } };

function rotuloPlaca(placa: string): string {
  return PLACAS.find((p) => p.valor === placa)?.rotulo ?? placa;
}

function hex4(n: number): string {
  return n.toString(16).padStart(4, '0');
}

export function Dispositivos() {
  const { dados, carregando, erro, recarregar } = useDados<Dispositivo[]>('/dispositivos');
  const [modal, setModal] = useState<{ id: number | null } | null>(null);
  const [form, setForm] = useState<FormDispositivo>(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [detectando, setDetectando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  function abrirNovo() {
    setForm(FORM_VAZIO);
    setErroForm(null);
    setModal({ id: null });
  }

  function abrirEditar(d: Dispositivo) {
    setForm({ nome: d.nome, placa: d.placa as Placa, porta: d.porta ?? '', notas: d.notas ?? '' });
    setErroForm(null);
    setModal({ id: d.id });
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setSalvando(true);
    setErroForm(null);
    const corpo = {
      nome: form.nome.trim(),
      placa: form.placa,
      porta: form.porta.trim() || undefined,
      notas: form.notas.trim() || undefined,
    };
    try {
      if (modal?.id == null) await api.post('/dispositivos', corpo);
      else await api.put(`/dispositivos/${modal.id}`, corpo);
      setModal(null);
      recarregar();
    } catch (err) {
      setErroForm(err instanceof Error ? err.message : 'Erro inesperado');
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(d: Dispositivo) {
    if (!window.confirm(`Excluir o dispositivo "${d.nome}"?`)) return;
    try {
      await api.del(`/dispositivos/${d.id}`);
      recarregar();
    } catch (err) {
      setAviso(err instanceof Error ? err.message : 'Erro ao excluir');
    }
  }

  // Preenche a porta com o identificador USB (VID:PID) da porta escolhida no navegador.
  async function detectarPorta() {
    const serial = (navigator as NavegadorSerial).serial;
    if (!serial) {
      setErroForm('Web Serial indisponível neste navegador. Use Chrome ou Edge.');
      return;
    }
    setDetectando(true);
    setErroForm(null);
    try {
      const porta = await serial.requestPort();
      const info = porta.getInfo();
      if (info.usbVendorId !== undefined && info.usbProductId !== undefined) {
        setForm((f) => ({ ...f, porta: `USB ${hex4(info.usbVendorId!)}:${hex4(info.usbProductId!)}` }));
      } else {
        setErroForm('A porta foi escolhida, mas o navegador não informou o identificador USB.');
      }
    } catch (err) {
      // Cancelar o seletor de porta também cai aqui.
      if (err instanceof DOMException && err.name === 'NotFoundError') return;
      setErroForm(err instanceof Error ? err.message : 'Não foi possível detectar a porta');
    } finally {
      setDetectando(false);
    }
  }

  return (
    <Pagina titulo="Dispositivos" acoes={<Botao aoClicar={abrirNovo}>Novo dispositivo</Botao>}>
      {carregando && !dados && <Carregando />}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {aviso && <Aviso tipo="erro">{aviso}</Aviso>}

      {dados && dados.length === 0 && (
        <p className="firmware-vazio">Nenhum dispositivo cadastrado.</p>
      )}

      {dados && dados.length > 0 && (
        <Grade>
          {dados.map((d) => (
            <article key={d.id} className="firmware-card">
              <div className="firmware-card-topo">
                <h2 className="firmware-card-titulo">{d.nome}</h2>
                <Selo cor="azul">{rotuloPlaca(d.placa)}</Selo>
              </div>
              <dl className="firmware-dl">
                <dt>Porta</dt>
                <dd>{d.porta || '—'}</dd>
                <dt>Último build</dt>
                <dd>{d.ultimoBuildId ? `Build #${d.ultimoBuildId}` : '—'}</dd>
                <dt>Última gravação</dt>
                <dd>{d.ultimaGravacao ? formatarDataHora(d.ultimaGravacao) : '—'}</dd>
              </dl>
              {d.notas && <p className="firmware-card-descricao">{d.notas}</p>}
              <div className="firmware-card-rodape">
                <Botao variante="secundario" aoClicar={() => abrirEditar(d)}>
                  Editar
                </Botao>
                <Botao variante="perigo" aoClicar={() => excluir(d)}>
                  Excluir
                </Botao>
              </div>
            </article>
          ))}
        </Grade>
      )}

      <Modal
        aberto={modal !== null}
        titulo={modal?.id == null ? 'Novo dispositivo' : 'Editar dispositivo'}
        aoFechar={() => setModal(null)}
      >
        <form className="firmware-form" onSubmit={salvar}>
          <Campo rotulo="Nome" valor={form.nome} aoMudar={(v) => setForm({ ...form, nome: v })} obrigatorio />
          <Selecao
            rotulo="Placa"
            valor={form.placa}
            aoMudar={(v) => setForm({ ...form, placa: v as Placa })}
            opcoes={PLACAS.map((p) => ({ valor: p.valor, rotulo: p.rotulo }))}
            obrigatorio
          />
          <div className="firmware-linha-gravar">
            <Campo rotulo="Porta" valor={form.porta} aoMudar={(v) => setForm({ ...form, porta: v })} />
            <Botao variante="secundario" desabilitado={detectando} aoClicar={detectarPorta}>
              {detectando ? 'Detectando...' : 'Detectar porta (Web Serial)'}
            </Botao>
          </div>
          <AreaTexto rotulo="Notas" valor={form.notas} aoMudar={(v) => setForm({ ...form, notas: v })} linhas={3} />
          {erroForm && <Aviso tipo="erro">{erroForm}</Aviso>}
          <div className="firmware-acoes-modal">
            <Botao variante="secundario" aoClicar={() => setModal(null)}>
              Cancelar
            </Botao>
            <Botao tipo="submit" desabilitado={salvando || form.nome.trim() === ''}>
              {salvando ? 'Salvando...' : 'Salvar'}
            </Botao>
          </div>
        </form>
      </Modal>
    </Pagina>
  );
}
