import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Botao, Icone } from '../../ui';
import type { ArquivoInfo } from '../../lib/tipos-api';

export interface NoArvore {
  tipo: 'pasta' | 'arquivo';
  nome: string;
  caminho: string; // caminho completo (pasta sem barra final)
  filhos?: NoArvore[];
}

// Monta a árvore de pastas a partir dos caminhos ("src/main.cpp" -> pasta "src" > arquivo "main.cpp").
export function construirArvore(arquivos: ArquivoInfo[]): NoArvore[] {
  const raiz: NoArvore = { tipo: 'pasta', nome: '', caminho: '', filhos: [] };

  for (const arquivo of arquivos) {
    const partes = arquivo.caminho.split('/').filter(Boolean);
    let atual = raiz;
    partes.forEach((parte, indice) => {
      const ultimo = indice === partes.length - 1;
      const caminho = partes.slice(0, indice + 1).join('/');
      if (ultimo) {
        atual.filhos!.push({ tipo: 'arquivo', nome: parte, caminho });
        return;
      }
      let pasta = atual.filhos!.find((f) => f.tipo === 'pasta' && f.nome === parte);
      if (!pasta) {
        pasta = { tipo: 'pasta', nome: parte, caminho, filhos: [] };
        atual.filhos!.push(pasta);
      }
      atual = pasta;
    });
  }

  ordenar(raiz.filhos!);
  return raiz.filhos!;
}

// Pastas primeiro, depois arquivos, ambos em ordem alfabética.
function ordenar(nos: NoArvore[]) {
  nos.sort((a, b) => {
    if (a.tipo !== b.tipo) return a.tipo === 'pasta' ? -1 : 1;
    return a.nome.localeCompare(b.nome, 'pt-BR');
  });
  nos.forEach((n) => n.filhos && ordenar(n.filhos));
}

export function ArvoreArquivos({
  arquivos,
  ativo,
  aoAbrir,
  aoNovo,
  aoRenomear,
  aoExcluir,
}: {
  arquivos: ArquivoInfo[];
  ativo: string | null;
  aoAbrir: (caminho: string) => void;
  aoNovo: () => void;
  aoRenomear: (caminho: string) => void;
  aoExcluir: (caminho: string) => void;
}) {
  const arvore = useMemo(() => construirArvore(arquivos), [arquivos]);
  // Pastas recolhidas (por caminho). Começa tudo aberto.
  const [recolhidas, setRecolhidas] = useState<Set<string>>(() => new Set());

  function alternar(caminho: string) {
    setRecolhidas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(caminho)) proximo.delete(caminho);
      else proximo.add(caminho);
      return proximo;
    });
  }

  function renderizar(nos: NoArvore[], nivel: number): ReactNode {
    return nos.map((no) => {
      const recuo = { paddingLeft: `${0.5 + nivel * 0.9}rem` };
      if (no.tipo === 'pasta') {
        const aberta = !recolhidas.has(no.caminho);
        return (
          <li key={'p:' + no.caminho}>
            <button
              type="button"
              className="firmware-arvore-linha firmware-arvore-pasta"
              style={recuo}
              aria-expanded={aberta}
              onClick={() => alternar(no.caminho)}
            >
              <span className="firmware-seta" aria-hidden="true">{aberta ? '▾' : '▸'}</span>
              <Icone nome="pasta" tamanho={16} />
              <span className="firmware-nome">{no.nome}</span>
            </button>
            {aberta && no.filhos && <ul className="firmware-arvore-lista">{renderizar(no.filhos, nivel + 1)}</ul>}
          </li>
        );
      }
      const selecionado = ativo === no.caminho;
      return (
        <li key={'a:' + no.caminho} className="firmware-arvore-item">
          <button
            type="button"
            className={selecionado ? 'firmware-arvore-linha firmware-arquivo ativo' : 'firmware-arvore-linha firmware-arquivo'}
            style={recuo}
            aria-current={selecionado ? 'true' : undefined}
            onClick={() => aoAbrir(no.caminho)}
          >
            <Icone nome="codigo" tamanho={16} />
            <span className="firmware-nome">{no.nome}</span>
          </button>
          <span className="firmware-arvore-acoes">
            <button
              type="button"
              className="firmware-icone-botao"
              aria-label={`Renomear ${no.caminho}`}
              title="Renomear"
              onClick={() => aoRenomear(no.caminho)}
            >
              <Icone nome="lapis" tamanho={14} />
            </button>
            <button
              type="button"
              className="firmware-icone-botao perigo"
              aria-label={`Excluir ${no.caminho}`}
              title="Excluir"
              onClick={() => aoExcluir(no.caminho)}
            >
              <Icone nome="lixeira" tamanho={14} />
            </button>
          </span>
        </li>
      );
    });
  }

  return (
    <div className="firmware-arvore">
      <div className="firmware-arvore-cabecalho">
        <span>Arquivos</span>
        <Botao variante="secundario" aoClicar={aoNovo}>
          Novo arquivo
        </Botao>
      </div>
      {arvore.length === 0 ? (
        <p className="firmware-vazio">Nenhum arquivo.</p>
      ) : (
        <ul className="firmware-arvore-lista">{renderizar(arvore, 0)}</ul>
      )}
    </div>
  );
}
