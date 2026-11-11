import { ErroHttp } from '../../lib/erros';

// Normaliza um caminho relativo da raiz do projeto (com "/") e recusa caminhos inseguros.
export function validarCaminho(c: string): string {
  if (typeof c !== 'string') {
    throw new ErroHttp(400, 'Caminho inválido');
  }
  const bruto = c.trim();
  if (bruto === '') {
    throw new ErroHttp(400, 'Caminho vazio');
  }
  if (bruto.length > 200) {
    throw new ErroHttp(400, 'Caminho muito longo');
  }
  if (bruto.includes('\\')) {
    throw new ErroHttp(400, 'Caminho não pode conter "\\"');
  }
  if (bruto.startsWith('/') || /^[a-zA-Z]:/.test(bruto)) {
    throw new ErroHttp(400, 'Caminho deve ser relativo à raiz do projeto');
  }
  const partes = bruto.split('/');
  if (partes.some((p) => p === '..')) {
    throw new ErroHttp(400, 'Caminho não pode conter ".."');
  }
  const limpo = partes.filter((p) => p !== '' && p !== '.').join('/');
  if (limpo === '') {
    throw new ErroHttp(400, 'Caminho vazio');
  }
  return limpo;
}
