import { useMemo, useRef } from 'react';
import type { KeyboardEvent, UIEvent } from 'react';

// Editor simples: textarea monoespaçado com numeração de linhas sincronizada.
export function EditorCodigo({
  caminho,
  valor,
  aoMudar,
  aoSalvar,
  naoSalvo,
  carregando,
}: {
  caminho: string;
  valor: string;
  aoMudar: (valor: string) => void;
  aoSalvar: () => void;
  naoSalvo: boolean;
  carregando?: boolean;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const numeros = useRef<HTMLDivElement>(null);

  const quantidadeLinhas = useMemo(() => valor.split('\n').length, [valor]);

  function aoRolar(e: UIEvent<HTMLTextAreaElement>) {
    if (numeros.current) numeros.current.scrollTop = e.currentTarget.scrollTop;
  }

  function aoTecla(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      aoSalvar();
      return;
    }
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const el = e.currentTarget;
      // setRangeText mantém o cursor depois dos espaços inseridos.
      el.setRangeText('  ', el.selectionStart, el.selectionEnd, 'end');
      aoMudar(el.value);
    }
  }

  return (
    <div className="firmware-editor-codigo">
      <div className="firmware-editor-barra">
        <span className="firmware-caminho">{caminho}</span>
        <span className={naoSalvo ? 'firmware-nao-salvo' : 'firmware-salvo'}>
          {naoSalvo ? '● não salvo' : 'salvo'}
        </span>
      </div>
      {carregando ? (
        <p className="firmware-vazio">Carregando arquivo...</p>
      ) : (
        <div className="firmware-editor-corpo">
          <div className="firmware-numeros" ref={numeros} aria-hidden="true">
            {Array.from({ length: quantidadeLinhas }, (_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
          <textarea
            ref={area}
            className="firmware-textarea"
            value={valor}
            spellCheck={false}
            wrap="off"
            aria-label={`Conteúdo de ${caminho}`}
            onChange={(e) => aoMudar(e.target.value)}
            onKeyDown={aoTecla}
            onScroll={aoRolar}
          />
        </div>
      )}
    </div>
  );
}
