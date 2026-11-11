// "Detector de Gestos!" -> "detector-de-gestos"
export function gerarSlug(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Devolve a base se estiver livre; senão acrescenta -2, -3, ...
export async function slugUnico(base: string, existe: (s: string) => Promise<boolean>): Promise<string> {
  const raiz = base || 'item';
  if (!(await existe(raiz))) {
    return raiz;
  }
  let n = 2;
  while (await existe(`${raiz}-${n}`)) {
    n++;
  }
  return `${raiz}-${n}`;
}
