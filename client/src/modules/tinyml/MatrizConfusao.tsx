import './tinyml.css';

// Matriz de confusão: linhas são a classe real, colunas a classe prevista.
// A intensidade da cor segue a proporção do valor dentro da sua linha.
export function MatrizConfusao({ matriz, classes }: { matriz: number[][]; classes: string[] }) {
  const n = matriz.length;
  const rotulos = (i: number) => classes[i] ?? `Classe ${i + 1}`;

  return (
    <div className="tinyml-matriz-rolagem">
      <table className="tinyml-matriz" aria-label="Matriz de confusão">
        <thead>
          <tr>
            <th scope="col">Real \ Previsto</th>
            {matriz.map((_, j) => (
              <th key={j} scope="col">
                {rotulos(j)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matriz.map((linha, i) => {
            const soma = linha.reduce((acc, v) => acc + v, 0);
            return (
              <tr key={i}>
                <th scope="row">{rotulos(i)}</th>
                {Array.from({ length: n }, (_, j) => {
                  const valor = linha[j] ?? 0;
                  const proporcao = soma > 0 ? valor / soma : 0;
                  return (
                    <td
                      key={j}
                      className="tinyml-matriz-celula"
                      style={{
                        background: `color-mix(in srgb, var(--cor-primaria) ${Math.round(proporcao * 100)}%, transparent)`,
                      }}
                      title={`${rotulos(i)} previsto como ${rotulos(j)}: ${valor}`}
                    >
                      <span>{valor}</span>
                      <span className="tinyml-matriz-pct">{Math.round(proporcao * 100)}%</span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
