import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { Modelo, TreinoModelo, TreinoModeloResumo } from '../../lib/tipos-modelos';
import { Aviso, Caixa, Carregando, Cartao, formatarDataHora } from '../../ui';
import { mensagemErro } from '../tinyml/componentes';

// Compara de 2 a 4 treinos concluídos lado a lado: parâmetros (os que mudaram ficam destacados),
// métricas (melhor valor destacado) e tamanho. Para TinyML, indica se cabe na placa-alvo.

const MAXIMO = 4;
const MINIMO = 2;

// Métricas comparáveis. `melhor` diz se o valor maior ou o menor é o melhor (undefined = sem julgamento).
const METRICAS: { chave: string; rotulo: string; percentual?: boolean; melhor?: 'maior' | 'menor' }[] = [
  { chave: 'acuracia', rotulo: 'Acurácia', percentual: true, melhor: 'maior' },
  { chave: 'acuraciaValidacao', rotulo: 'Acurácia (val.)', percentual: true, melhor: 'maior' },
  { chave: 'f1', rotulo: 'F1', percentual: true, melhor: 'maior' },
  { chave: 'precisao', rotulo: 'Precisão', percentual: true, melhor: 'maior' },
  { chave: 'recall', rotulo: 'Recall', percentual: true, melhor: 'maior' },
  { chave: 'r2', rotulo: 'R²', melhor: 'maior' },
  { chave: 'mae', rotulo: 'MAE', melhor: 'menor' },
  { chave: 'rmse', rotulo: 'RMSE', melhor: 'menor' },
  { chave: 'perda', rotulo: 'Perda', melhor: 'menor' },
  { chave: 'perdaValidacao', rotulo: 'Perda (val.)', melhor: 'menor' },
  { chave: 'tokensTreinados', rotulo: 'Tokens treinados' },
];

function formatarBytes(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB`;
}

function formatarMetricaValor(valor: number, percentual?: boolean): string {
  if (percentual) {
    const pct = valor <= 1 ? valor * 100 : valor;
    return `${pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  }
  return valor.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
}

// Achata um objeto de parâmetros em pares "caminho.do.campo" -> texto, para comparar campo a campo.
function achatar(valor: unknown, prefixo = ''): Record<string, string> {
  const saida: Record<string, string> = {};
  if (valor !== null && typeof valor === 'object' && !Array.isArray(valor)) {
    for (const [chave, filho] of Object.entries(valor as Record<string, unknown>)) {
      Object.assign(saida, achatar(filho, prefixo ? `${prefixo}.${chave}` : chave));
    }
    return saida;
  }
  saida[prefixo] = typeof valor === 'string' ? valor : JSON.stringify(valor);
  return saida;
}

export function Comparar({ modelo, treinos }: { modelo: Modelo; treinos: TreinoModeloResumo[] }) {
  const concluidos = treinos.filter((t) => t.status === 'SUCESSO');
  const [selecionados, setSelecionados] = useState<number[]>([]);
  const [detalhes, setDetalhes] = useState<Record<number, TreinoModelo>>({});
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const chave = selecionados.join(',');
  useEffect(() => {
    if (selecionados.length < MINIMO) return;
    let cancelado = false;
    setCarregando(true);
    setErro(null);
    Promise.all(selecionados.map((id) => api.get<TreinoModelo>(`/treinos-modelo/${id}`)))
      .then((lista) => {
        if (!cancelado) setDetalhes(Object.fromEntries(lista.map((t) => [t.id, t])));
      })
      .catch((e: unknown) => {
        if (!cancelado) setErro(mensagemErro(e));
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
    // o efeito depende da lista de ids (chave), não da referência do array
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  function alternar(id: number, marcado: boolean) {
    if (!marcado) {
      setSelecionados((atual) => atual.filter((x) => x !== id));
      return;
    }
    setSelecionados((atual) => (atual.includes(id) || atual.length >= MAXIMO ? atual : [...atual, id]));
  }

  if (concluidos.length === 0) {
    return <Aviso tipo="info">Nenhum treino concluído para comparar. Conclua ao menos dois treinos.</Aviso>;
  }

  const escolhidos = selecionados.map((id) => detalhes[id]).filter((t): t is TreinoModelo => Boolean(t));
  const prontos = selecionados.length >= MINIMO && escolhidos.length === selecionados.length;

  // Parâmetros: união dos campos; um campo "mudou" se os valores diferem entre os treinos escolhidos.
  const parametrosPorTreino = escolhidos.map((t) => achatar(t.parametros));
  const nomesParametros = Array.from(new Set(parametrosPorTreino.flatMap((p) => Object.keys(p)))).sort();

  const metricasPresentes = METRICAS.filter((m) =>
    escolhidos.some((t) => typeof t.metricas?.[m.chave] === 'number'),
  );

  function melhorDeMetrica(chaveMetrica: string, melhor: 'maior' | 'menor' | undefined): number | undefined {
    if (!melhor) return undefined;
    const valores = escolhidos
      .map((t) => t.metricas?.[chaveMetrica])
      .filter((v): v is number => typeof v === 'number');
    if (valores.length < 2) return undefined;
    return melhor === 'maior' ? Math.max(...valores) : Math.min(...valores);
  }

  return (
    <div className="det-comparar">
      <Cartao titulo="Escolha os treinos">
        <div className="det-escolha">
          {concluidos.map((t) => {
            const marcado = selecionados.includes(t.id);
            const bloqueado = !marcado && selecionados.length >= MAXIMO;
            return (
              <div key={t.id} className={bloqueado ? 'det-opcao det-opcao-bloqueada' : 'det-opcao'}>
                <Caixa
                  rotulo={`#${t.numero}${t.publicado ? ' (publicado)' : ''} · ${formatarDataHora(t.criadoEm)}`}
                  marcado={marcado}
                  aoMudar={(v) => alternar(t.id, v)}
                />
              </div>
            );
          })}
        </div>
        {selecionados.length < MINIMO && (
          <p className="det-ajuda">Escolha de {MINIMO} a {MAXIMO} treinos concluídos.</p>
        )}
        {selecionados.length >= MAXIMO && (
          <p className="det-ajuda">Limite de {MAXIMO} treinos na comparação.</p>
        )}
      </Cartao>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {selecionados.length >= MINIMO && carregando && !prontos && <Carregando />}

      {prontos && (
        <div className="det-tabela-rolagem">
          <table className="det-comparar-tabela">
            <thead>
              <tr>
                <th scope="col">Item</th>
                {escolhidos.map((t) => (
                  <th key={t.id} scope="col">
                    #{t.numero}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="det-grupo">
                <th colSpan={escolhidos.length + 1} scope="colgroup">
                  Parâmetros (destacados os que mudaram)
                </th>
              </tr>
              {nomesParametros.map((nome) => {
                const valores = parametrosPorTreino.map((p) => p[nome] ?? '—');
                const mudou = new Set(valores).size > 1;
                return (
                  <tr key={nome} className={mudou ? 'det-mudou' : undefined}>
                    <th scope="row">{nome}</th>
                    {valores.map((v, i) => (
                      <td key={i}>
                        <code>{v}</code>
                      </td>
                    ))}
                  </tr>
                );
              })}

              <tr className="det-grupo">
                <th colSpan={escolhidos.length + 1} scope="colgroup">
                  Métricas (melhor valor em destaque)
                </th>
              </tr>
              {metricasPresentes.map((m) => {
                const melhor = melhorDeMetrica(m.chave, m.melhor);
                return (
                  <tr key={m.chave}>
                    <th scope="row">{m.rotulo}</th>
                    {escolhidos.map((t) => {
                      const valor = t.metricas?.[m.chave];
                      if (typeof valor !== 'number') {
                        return <td key={t.id}>—</td>;
                      }
                      const destaque = melhor !== undefined && valor === melhor;
                      return (
                        <td key={t.id} className={destaque ? 'det-melhor' : undefined}>
                          {destaque ? <strong>{formatarMetricaValor(valor, m.percentual)}</strong> : formatarMetricaValor(valor, m.percentual)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}

              <tr className="det-grupo">
                <th colSpan={escolhidos.length + 1} scope="colgroup">
                  Modelo
                </th>
              </tr>
              <tr>
                <th scope="row">Tamanho</th>
                {escolhidos.map((t) => (
                  <td key={t.id}>{formatarBytes(t.tamanhoBytes)}</td>
                ))}
              </tr>
              {modelo.tipo === 'TINYML' && (
                <tr>
                  <th scope="row">Cabe na placa-alvo</th>
                  {escolhidos.map((t) => {
                    const flash = 'limiteFlashKb' in t.parametros ? t.parametros.limiteFlashKb : null;
                    if (flash === null || t.tamanhoBytes === null) return <td key={t.id}>—</td>;
                    const cabe = t.tamanhoBytes / 1024 <= flash;
                    return (
                      <td key={t.id} className={cabe ? 'det-cabe' : 'det-nao-cabe'}>
                        {cabe ? 'Sim' : 'Não'} (limite {flash} KB de flash)
                      </td>
                    );
                  })}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
