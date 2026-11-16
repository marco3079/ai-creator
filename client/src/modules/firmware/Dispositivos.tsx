import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Abas, AreaTexto, Aviso, Botao, Campo, Carregando, Grade, Modal, Pagina, Selecao, Selo, formatarDataHora } from '../../ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useEventosTrabalho } from '../../lib/eventos';
import { useDados } from '../../lib/useDados';
import { PLACAS } from '../../lib/tipos-api';
import type { BuildResumo, Placa, ProjetoResumo } from '../../lib/tipos-api';
import type { ChaveGerada, DispositivoFrota } from '../../lib/tipos-frota';
import './firmware.css';
import './frota.css';

type Filtro = 'todos' | 'online' | 'offline';

// A lista de builds pode trazer o caminho do artefato OTA (campo do servidor, validado no PUT /alvo).
type BuildOta = BuildResumo & { artefatoOta?: string | null };

interface FormDispositivo {
  nome: string;
  placa: Placa;
  porta: string;
  notas: string;
  projetoId: string; // '' = sem projeto
}

const FORM_VAZIO: FormDispositivo = { nome: '', placa: 'ESP32', porta: '', notas: '', projetoId: '' };
const CHAVE_TOKEN = 'aicreator.token';
const INTERVALO_SEGURANCA_MS = 30_000;
const ATRASO_AO_VIVO_MS = 1_000;

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

function msgErro(err: unknown, padrao: string): string {
  return err instanceof Error ? err.message : padrao;
}

function cabecalhosAuth(): Record<string, string> {
  const token = localStorage.getItem(CHAVE_TOKEN);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function erroDaResposta(resposta: Response): Promise<string> {
  try {
    const dados = (await resposta.json()) as { erro?: string };
    return dados.erro ?? 'Erro inesperado';
  } catch {
    return 'Erro inesperado';
  }
}

// POST /dispositivos/:id/comando. Sem broker MQTT o servidor responde 503.
async function enviarComando(id: number, acao: 'atualizar' | 'reiniciar'): Promise<void> {
  const resposta = await fetch(`/api/dispositivos/${id}/comando`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...cabecalhosAuth() },
    body: JSON.stringify({ acao }),
  });
  if (resposta.status === 503) throw new Error('Broker MQTT indisponível');
  if (!resposta.ok) throw new Error(await erroDaResposta(resposta));
}

// GET /dispositivos/:id/config.h?chave=... devolve o aic_config.h preenchido; o navegador baixa o arquivo.
async function baixarConfig(id: number, chave: string): Promise<void> {
  const resposta = await fetch(`/api/dispositivos/${id}/config.h?chave=${encodeURIComponent(chave)}`, {
    headers: cabecalhosAuth(),
  });
  if (!resposta.ok) throw new Error(await erroDaResposta(resposta));
  const url = URL.createObjectURL(await resposta.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = 'aic_config.h';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// "há 5 min", "há 2 h" etc. a partir do último contato.
function visto(iso: string | null): string {
  if (!iso) return 'nunca visto';
  const instante = new Date(iso).getTime();
  if (Number.isNaN(instante)) return 'nunca visto';
  const segundos = Math.max(0, Math.floor((Date.now() - instante) / 1000));
  if (segundos < 60) return `há ${segundos} s`;
  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  return `há ${Math.floor(horas / 24)} d`;
}

function versaoTexto(d: DispositivoFrota): string {
  const atual = d.buildAtualId != null ? `#${d.buildAtualId}` : '—';
  return d.buildAlvoId != null ? `${atual} → #${d.buildAlvoId}` : atual;
}

// Cor do selo do status da OTA. O servidor guarda texto livre: "baixando", "ok" ou "erro: ...".
function corOta(status: string): 'verde' | 'vermelho' | 'amarelo' {
  if (status.startsWith('erro')) return 'vermelho';
  if (status === 'ok') return 'verde';
  return 'amarelo';
}

// Barras do sinal Wi-Fi: 4 com RSSI forte (>= -60 dBm), 1 com fraco.
function Sinal({ rssi }: { rssi: number | null | undefined }) {
  const nivel = rssi == null ? 0 : rssi >= -60 ? 4 : rssi >= -70 ? 3 : rssi >= -80 ? 2 : 1;
  return (
    <span className="frota-sinal" role="img" aria-label={rssi == null ? 'Sinal não informado' : `Sinal ${rssi} dBm`}>
      {[1, 2, 3, 4].map((n) => (
        <span
          key={n}
          className={n <= nivel ? 'frota-barra frota-barra-on' : 'frota-barra'}
          style={{ height: `${n * 4 + 2}px` }}
        />
      ))}
    </span>
  );
}

export function Dispositivos() {
  const navigate = useNavigate();
  const { usuario } = useAuth();
  const podeEscrever = usuario?.perfil === 'ADMIN' || usuario?.perfil === 'DEV';

  const { dados, carregando, erro, recarregar } = useDados<DispositivoFrota[]>('/dispositivos');
  const { dados: projetos } = useDados<ProjetoResumo[]>('/projetos');

  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [aviso, setAviso] = useState<{ tipo: 'erro' | 'sucesso'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState<number | null>(null); // dispositivo com comando em curso

  // Modal de cadastro/edição
  const [modal, setModal] = useState<{ id: number | null } | null>(null);
  const [form, setForm] = useState<FormDispositivo>(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [detectando, setDetectando] = useState(false);

  // Chave gerada (mostrada uma vez)
  const [chaveNova, setChaveNova] = useState<{ id: number; chave: string } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [erroChave, setErroChave] = useState<string | null>(null);

  // Definir versão (alvo OTA)
  const [alvoDe, setAlvoDe] = useState<DispositivoFrota | null>(null);
  const [alvoEscolhido, setAlvoEscolhido] = useState('');
  const [salvandoAlvo, setSalvandoAlvo] = useState(false);
  const [erroAlvo, setErroAlvo] = useState<string | null>(null);
  const { dados: buildsDoAlvo, carregando: carregandoBuilds } = useDados<BuildOta[]>(
    alvoDe?.projetoId ? `/builds?projetoId=${alvoDe.projetoId}` : null,
  );
  const opcoesAlvo = alvoDe
    ? (buildsDoAlvo ?? []).filter((b) => b.status === 'SUCESSO' && b.placa === alvoDe.placa && !!b.artefatoOta)
    : [];

  // Atualização ao vivo: eventos 'dispositivo' com atraso de 1 s, e recarga de segurança a cada 30 s.
  const atrasoRef = useRef<number | null>(null);
  const agendarRecarga = useCallback(() => {
    if (atrasoRef.current !== null) window.clearTimeout(atrasoRef.current);
    atrasoRef.current = window.setTimeout(() => {
      atrasoRef.current = null;
      recarregar();
    }, ATRASO_AO_VIVO_MS);
  }, [recarregar]);

  useEventosTrabalho((e) => e.tipo === 'dispositivo', agendarRecarga);

  useEffect(() => {
    const intervalo = window.setInterval(recarregar, INTERVALO_SEGURANCA_MS);
    return () => window.clearInterval(intervalo);
  }, [recarregar]);

  useEffect(() => {
    return () => {
      if (atrasoRef.current !== null) window.clearTimeout(atrasoRef.current);
    };
  }, []);

  function abrirNovo() {
    setForm(FORM_VAZIO);
    setErroForm(null);
    setModal({ id: null });
  }

  function abrirEditar(d: DispositivoFrota) {
    setForm({
      nome: d.nome,
      placa: d.placa as Placa,
      porta: d.porta ?? '',
      notas: d.notas ?? '',
      projetoId: d.projetoId != null ? String(d.projetoId) : '',
    });
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
      projetoId: form.projetoId ? Number(form.projetoId) : null,
    };
    try {
      if (modal?.id == null) await api.post('/dispositivos', corpo);
      else await api.put(`/dispositivos/${modal.id}`, corpo);
      setModal(null);
      recarregar();
    } catch (err) {
      setErroForm(msgErro(err, 'Erro inesperado'));
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(d: DispositivoFrota) {
    if (!window.confirm(`Excluir o dispositivo "${d.nome}"?`)) return;
    try {
      await api.del(`/dispositivos/${d.id}`);
      recarregar();
    } catch (err) {
      setAviso({ tipo: 'erro', texto: msgErro(err, 'Erro ao excluir') });
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
      setErroForm(msgErro(err, 'Não foi possível detectar a porta'));
    } finally {
      setDetectando(false);
    }
  }

  async function gerarChave(d: DispositivoFrota) {
    const pergunta = d.chavePrefixo
      ? `Gerar nova chave para "${d.nome}"? A chave atual deixa de funcionar e a placa precisará do novo aic_config.h.`
      : `Gerar chave para "${d.nome}"?`;
    if (!window.confirm(pergunta)) return;
    setAviso(null);
    try {
      const resposta = await api.post<ChaveGerada>(`/dispositivos/${d.id}/chave`);
      setChaveNova({ id: d.id, chave: resposta.chave });
      setCopiado(false);
      setErroChave(null);
      recarregar();
    } catch (err) {
      setAviso({ tipo: 'erro', texto: msgErro(err, 'Erro ao gerar a chave') });
    }
  }

  async function copiarChave() {
    if (!chaveNova) return;
    try {
      await navigator.clipboard.writeText(chaveNova.chave);
      setCopiado(true);
    } catch {
      setErroChave('Não foi possível copiar. Selecione a chave e copie manualmente.');
    }
  }

  async function baixarArquivoConfig() {
    if (!chaveNova) return;
    setErroChave(null);
    try {
      await baixarConfig(chaveNova.id, chaveNova.chave);
    } catch (err) {
      setErroChave(msgErro(err, 'Erro ao baixar o aic_config.h'));
    }
  }

  function abrirAlvo(d: DispositivoFrota) {
    setAlvoDe(d);
    setAlvoEscolhido(d.buildAlvoId != null ? String(d.buildAlvoId) : '');
    setErroAlvo(null);
  }

  async function salvarAlvo(e: FormEvent) {
    e.preventDefault();
    if (!alvoDe) return;
    setSalvandoAlvo(true);
    setErroAlvo(null);
    try {
      await api.put(`/dispositivos/${alvoDe.id}/alvo`, { buildId: alvoEscolhido ? Number(alvoEscolhido) : null });
      setAlvoDe(null);
      recarregar();
    } catch (err) {
      setErroAlvo(msgErro(err, 'Erro ao definir a versão'));
    } finally {
      setSalvandoAlvo(false);
    }
  }

  async function comando(d: DispositivoFrota, acao: 'atualizar' | 'reiniciar') {
    if (acao === 'reiniciar' && !window.confirm(`Reiniciar "${d.nome}" agora?`)) return;
    setOcupado(d.id);
    setAviso(null);
    try {
      await enviarComando(d.id, acao);
      const acaoTexto = acao === 'atualizar' ? 'Atualização' : 'Reinício';
      setAviso({ tipo: 'sucesso', texto: `${acaoTexto} enviado para ${d.nome}.` });
    } catch (err) {
      setAviso({ tipo: 'erro', texto: msgErro(err, 'Erro ao enviar o comando') });
    } finally {
      setOcupado(null);
    }
  }

  const todos = dados ?? [];
  const qtdOnline = todos.filter((d) => d.online).length;
  const lista = todos.filter((d) => filtro === 'todos' || (filtro === 'online' ? d.online : !d.online));

  return (
    <Pagina titulo="Frota" acoes={podeEscrever ? <Botao aoClicar={abrirNovo}>Novo dispositivo</Botao> : undefined}>
      {carregando && !dados && <Carregando />}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}

      {dados && dados.length > 0 && (
        <div className="frota-filtros">
          <Abas
            abas={[
              { id: 'todos', rotulo: `Todos (${todos.length})` },
              { id: 'online', rotulo: `Online (${qtdOnline})` },
              { id: 'offline', rotulo: `Offline (${todos.length - qtdOnline})` },
            ]}
            ativa={filtro}
            aoMudar={(id) => setFiltro(id as Filtro)}
          />
        </div>
      )}

      {dados && dados.length === 0 && <p className="firmware-vazio">Nenhum dispositivo cadastrado.</p>}
      {dados && dados.length > 0 && lista.length === 0 && (
        <p className="firmware-vazio">Nenhum dispositivo {filtro === 'online' ? 'online' : 'offline'}.</p>
      )}

      {lista.length > 0 && (
        <Grade>
          {lista.map((d) => (
            <article key={d.id} className="firmware-card frota-card">
              <div className="firmware-card-topo">
                <h2 className="firmware-card-titulo">
                  <span
                    className={d.online ? 'frota-bolinha frota-bolinha-on' : 'frota-bolinha'}
                    role="img"
                    aria-label={d.online ? 'Online' : 'Offline'}
                    title={d.online ? 'Online' : 'Offline'}
                  />
                  {d.nome}
                </h2>
                <Selo cor="azul">{rotuloPlaca(d.placa)}</Selo>
              </div>
              <dl className="firmware-dl">
                <dt>Conexão</dt>
                <dd>
                  {d.online ? 'Online' : 'Offline'} · {visto(d.ultimoContato)}
                </dd>
                <dt>Sinal</dt>
                <dd>
                  <Sinal rssi={d.telemetria?.rssi} />
                  {d.telemetria?.rssi != null ? `${d.telemetria.rssi} dBm` : '—'}
                </dd>
                <dt>Versão</dt>
                <dd>{versaoTexto(d)}</dd>
                <dt>OTA</dt>
                <dd>{d.statusOta ? <Selo cor={corOta(d.statusOta)}>{d.statusOta}</Selo> : '—'}</dd>
                <dt>Porta</dt>
                <dd>{d.porta || '—'}</dd>
                <dt>Projeto</dt>
                <dd>{d.projeto?.nome ?? '—'}</dd>
                <dt>Chave</dt>
                <dd>{d.chavePrefixo ? `${d.chavePrefixo}…` : 'Sem chave'}</dd>
              </dl>
              {d.notas && <p className="firmware-card-descricao">{d.notas}</p>}
              <div className="firmware-card-rodape frota-acoes">
                <Botao variante="secundario" aoClicar={() => navigate(`/app/dispositivos/${d.id}`)}>
                  Abrir
                </Botao>
                {podeEscrever && (
                  <>
                    <Botao variante="secundario" aoClicar={() => abrirEditar(d)}>
                      Editar
                    </Botao>
                    <Botao variante="secundario" aoClicar={() => gerarChave(d)}>
                      Gerar chave
                    </Botao>
                    <Botao variante="secundario" aoClicar={() => abrirAlvo(d)}>
                      Definir versão
                    </Botao>
                    <Botao
                      variante="secundario"
                      desabilitado={ocupado === d.id}
                      aoClicar={() => comando(d, 'atualizar')}
                    >
                      Atualizar agora
                    </Botao>
                    <Botao
                      variante="secundario"
                      desabilitado={ocupado === d.id}
                      aoClicar={() => comando(d, 'reiniciar')}
                    >
                      Reiniciar
                    </Botao>
                    <Botao variante="perigo" aoClicar={() => excluir(d)}>
                      Excluir
                    </Botao>
                  </>
                )}
              </div>
            </article>
          ))}
        </Grade>
      )}

      {/* Cadastro e edição */}
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
          <Selecao
            rotulo="Projeto"
            valor={form.projetoId}
            aoMudar={(v) => setForm({ ...form, projetoId: v })}
            opcoes={(projetos ?? []).map((p) => ({ valor: String(p.id), rotulo: p.nome }))}
            vazio="Nenhum"
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

      {/* Chave: mostrada uma vez */}
      <Modal
        aberto={chaveNova !== null}
        titulo="Chave do dispositivo"
        aoFechar={() => setChaveNova(null)}
      >
        {chaveNova && (
          <div className="frota-chave-modal">
            <p>
              Esta chave aparece só agora. Ela vai dentro do <code>aic_config.h</code> da placa. Gerar outra
              invalida esta.
            </p>
            <code className="frota-chave">{chaveNova.chave}</code>
            {erroChave && <Aviso tipo="erro">{erroChave}</Aviso>}
            {copiado && <Aviso tipo="sucesso">Chave copiada.</Aviso>}
            <div className="firmware-acoes-modal">
              <Botao variante="secundario" aoClicar={copiarChave}>
                Copiar
              </Botao>
              <Botao aoClicar={baixarArquivoConfig}>Baixar aic_config.h</Botao>
            </div>
          </div>
        )}
      </Modal>

      {/* Definir versão (build SUCESSO com artefato OTA da mesma placa) */}
      <Modal
        aberto={alvoDe !== null}
        titulo={`Versão de ${alvoDe?.nome ?? ''}`}
        aoFechar={() => setAlvoDe(null)}
      >
        {alvoDe && (
          <form className="firmware-form" onSubmit={salvarAlvo}>
            {!alvoDe.projetoId && (
              <Aviso tipo="info">Vincule um projeto a este dispositivo (Editar) para escolher a versão.</Aviso>
            )}
            {alvoDe.projetoId && carregandoBuilds && <Carregando />}
            {alvoDe.projetoId && !carregandoBuilds && opcoesAlvo.length === 0 && (
              <Aviso tipo="info">Nenhuma compilação com sucesso e artefato OTA para esta placa neste projeto.</Aviso>
            )}
            <Selecao
              rotulo="Build alvo"
              valor={alvoEscolhido}
              aoMudar={setAlvoEscolhido}
              opcoes={opcoesAlvo.map((b) => ({
                valor: String(b.id),
                rotulo: `Build #${b.id} (${formatarDataHora(b.criadoEm)})`,
              }))}
              vazio="Nenhuma"
            />
            {erroAlvo && <Aviso tipo="erro">{erroAlvo}</Aviso>}
            <div className="firmware-acoes-modal">
              <Botao variante="secundario" aoClicar={() => setAlvoDe(null)}>
                Cancelar
              </Botao>
              <Botao tipo="submit" desabilitado={salvandoAlvo || !alvoDe.projetoId}>
                {salvandoAlvo ? 'Salvando...' : 'Salvar'}
              </Botao>
            </div>
          </form>
        )}
      </Modal>
    </Pagina>
  );
}
