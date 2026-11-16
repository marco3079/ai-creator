import { useCallback, useEffect, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Aviso, Botao, Carregando, Cartao, Pagina, Selo, formatarDataHora } from '../../ui';
import { GraficoLinha } from '../../layout/GraficoLinha';
import type { PontoGrafico } from '../../layout/GraficoLinha';
import { useEventosTrabalho } from '../../lib/eventos';
import { useDados } from '../../lib/useDados';
import { PLACAS } from '../../lib/tipos-api';
import type { AmostraTelemetria, DispositivoFrota } from '../../lib/tipos-frota';
import './firmware.css';
import './frota.css';

const INTERVALO_SEGURANCA_MS = 30_000;
const ATRASO_AO_VIVO_MS = 1_000;
// O sinal Wi-Fi vai de -100 dBm (fundo do gráfico) a 0 dBm (topo). Valores fora da faixa são limitados pelo gráfico.
const RSSI_BASE_DBM = -100;

function rotuloPlaca(placa: string): string {
  return PLACAS.find((p) => p.valor === placa)?.rotulo ?? placa;
}

function numeroOuNulo(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function horaDaAmostra(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function valorTexto(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function corOta(status: string): 'verde' | 'vermelho' | 'amarelo' {
  if (status.startsWith('erro')) return 'vermelho';
  if (status === 'ok') return 'verde';
  return 'amarelo';
}

export function DetalheDispositivo() {
  const { id: idBruto } = useParams();
  const navigate = useNavigate();
  const id = idBruto && /^\d+$/.test(idBruto) ? Number(idBruto) : null;

  const { dados: d, carregando, erro, recarregar: recarregarDispositivo } = useDados<DispositivoFrota>(
    id !== null ? `/dispositivos/${id}` : null,
  );
  const { dados: amostras, recarregar: recarregarTelemetria } = useDados<AmostraTelemetria[]>(
    id !== null ? `/dispositivos/${id}/telemetria?horas=24` : null,
  );

  const recarregarTudo = useCallback(() => {
    recarregarDispositivo();
    recarregarTelemetria();
  }, [recarregarDispositivo, recarregarTelemetria]);

  // Atualização ao vivo só dos eventos deste dispositivo, com atraso de 1 s; recarga de segurança a cada 30 s.
  const atrasoRef = useRef<number | null>(null);
  const agendarRecarga = useCallback(() => {
    if (atrasoRef.current !== null) window.clearTimeout(atrasoRef.current);
    atrasoRef.current = window.setTimeout(() => {
      atrasoRef.current = null;
      recarregarTudo();
    }, ATRASO_AO_VIVO_MS);
  }, [recarregarTudo]);

  useEventosTrabalho((e) => e.tipo === 'dispositivo' && e.id === id, agendarRecarga);

  useEffect(() => {
    const intervalo = window.setInterval(recarregarTudo, INTERVALO_SEGURANCA_MS);
    return () => window.clearInterval(intervalo);
  }, [recarregarTudo]);

  useEffect(() => {
    return () => {
      if (atrasoRef.current !== null) window.clearTimeout(atrasoRef.current);
    };
  }, []);

  if (id === null) {
    return (
      <Pagina titulo="Dispositivo">
        <Aviso tipo="erro">Dispositivo inválido.</Aviso>
      </Pagina>
    );
  }

  const lista = amostras ?? [];
  const pontosRssi: PontoGrafico[] = lista.map((a) => {
    const rssi = numeroOuNulo(a.dados.rssi);
    return { rotulo: horaDaAmostra(a.em), valor: rssi === null ? null : rssi - RSSI_BASE_DBM };
  });
  const heapKb: PontoGrafico[] = lista.map((a) => {
    const bytes = numeroOuNulo(a.dados.heapLivre);
    return { rotulo: horaDaAmostra(a.em), valor: bytes === null ? null : bytes / 1024 };
  });
  const temRssi = pontosRssi.some((p) => p.valor !== null);
  const temHeap = heapKb.some((p) => p.valor !== null);
  const maiorHeap = Math.max(1, ...heapKb.map((p) => p.valor ?? 0)) * 1.1;

  const entradasTelemetria = Object.entries(d?.telemetria ?? {});

  return (
    <Pagina
      titulo={d?.nome ?? 'Dispositivo'}
      acoes={<Botao variante="secundario" aoClicar={() => navigate('/app/dispositivos')}>Voltar à frota</Botao>}
    >
      {carregando && !d && <Carregando />}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      {d && (
        <>
          <Cartao titulo="Resumo">
            <dl className="firmware-dl">
              <dt>Conexão</dt>
              <dd>
                <Selo cor={d.online ? 'verde' : 'cinza'}>{d.online ? 'Online' : 'Offline'}</Selo>
              </dd>
              <dt>Placa</dt>
              <dd>{rotuloPlaca(d.placa)}</dd>
              <dt>Porta</dt>
              <dd>{d.porta || '—'}</dd>
              <dt>IP</dt>
              <dd>{d.ip || '—'}</dd>
              <dt>Último contato</dt>
              <dd>{d.ultimoContato ? formatarDataHora(d.ultimoContato) : '—'}</dd>
              <dt>Projeto</dt>
              <dd>
                {d.projeto ? <Link to={`/app/projetos/${d.projeto.id}`}>{d.projeto.nome}</Link> : '—'}
              </dd>
              <dt>Chave</dt>
              <dd>{d.chavePrefixo ? `${d.chavePrefixo}…` : 'Sem chave (ainda não configurado para OTA)'}</dd>
              {d.notas && (
                <>
                  <dt>Notas</dt>
                  <dd>{d.notas}</dd>
                </>
              )}
            </dl>
          </Cartao>

          <div className="frota-graficos">
            <Cartao titulo="Sinal Wi-Fi (RSSI) nas últimas 24 h">
              {temRssi ? (
                <GraficoLinha
                  pontos={pontosRssi}
                  maximo={100}
                  formatar={(v) => `${Math.round(v + RSSI_BASE_DBM)} dBm`}
                />
              ) : (
                <p className="firmware-vazio">Sem leituras de sinal nas últimas 24 h.</p>
              )}
            </Cartao>
            <Cartao titulo="Memória livre (heap) nas últimas 24 h">
              {temHeap ? (
                <GraficoLinha
                  pontos={heapKb}
                  maximo={maiorHeap}
                  formatar={(v) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB`}
                />
              ) : (
                <p className="firmware-vazio">Sem leituras de memória nas últimas 24 h.</p>
              )}
            </Cartao>
          </div>

          <Cartao titulo="Última telemetria">
            {entradasTelemetria.length === 0 ? (
              <p className="firmware-vazio">Nenhuma telemetria recebida ainda.</p>
            ) : (
              <table className="frota-tabela">
                <thead>
                  <tr>
                    <th scope="col">Chave</th>
                    <th scope="col">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {entradasTelemetria.map(([chave, valor]) => (
                    <tr key={chave}>
                      <th scope="row">{chave}</th>
                      <td>{valorTexto(valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Cartao>

          <Cartao titulo="Atualização OTA">
            <dl className="firmware-dl">
              <dt>Versão atual</dt>
              <dd>{d.buildAtualId != null ? `Build #${d.buildAtualId}` : '—'}</dd>
              <dt>Versão alvo</dt>
              <dd>{d.buildAlvoId != null ? `Build #${d.buildAlvoId}` : 'Nenhuma'}</dd>
              <dt>Status</dt>
              <dd>{d.statusOta ? <Selo cor={corOta(d.statusOta)}>{d.statusOta}</Selo> : '—'}</dd>
              <dt>Última OTA</dt>
              <dd>{d.ultimaOta ? formatarDataHora(d.ultimaOta) : '—'}</dd>
            </dl>
          </Cartao>

          <Cartao titulo="Como colocar esta placa na frota">
            <ol className="frota-guia">
              <li>
                Abra um projeto com o modelo <strong>OTA</strong> (placas ESP32 ou ESP32-S3) em{' '}
                <Link to="/app/projetos">Projetos</Link>, ou crie um novo a partir desse modelo.
              </li>
              <li>Na Frota, edite este dispositivo e escolha esse projeto.</li>
              <li>
                Clique em <strong>Gerar chave</strong> e baixe o <code>aic_config.h</code>. Coloque o arquivo na pasta{' '}
                <code>include/</code> do projeto e preencha <code>AIC_WIFI_SSID</code> e{' '}
                <code>AIC_WIFI_SENHA</code>.
              </li>
              <li>Compile o projeto e grave a placa pelo cabo USB.</li>
              <li>
                Quando a placa conectar ao Wi-Fi, ela aparece como <strong>Online</strong> na Frota. Para atualizar
                o firmware, use <strong>Definir versão</strong> e depois <strong>Atualizar agora</strong>.
              </li>
            </ol>
          </Cartao>
        </>
      )}
    </Pagina>
  );
}
