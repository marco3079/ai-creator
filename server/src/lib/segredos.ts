import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// Segredos do servidor. Ordem: variável de ambiente válida > valor já gravado em DATA_DIR/segredos.json
// > valor novo gerado e gravado. Valores de exemplo do .env.example não contam como válidos.
// Não importa ./config (config.ts importa este arquivo); usa o mesmo padrão de DATA_DIR.

export type NomeSegredo = 'JWT_SECRET' | 'INTERNO_TOKEN';

const VALORES_DE_EXEMPLO = new Set([
  'troque-este-segredo',
  'troque-token-interno',
  'troque-este-segredo-de-exemplo',
  '',
]);

const avisados = new Set<NomeSegredo>();

function arquivoSegredos(): { dir: string; arquivo: string } {
  const dir = process.env.DATA_DIR ?? path.resolve('dados');
  return { dir, arquivo: path.join(dir, 'segredos.json') };
}

function lerGravados(arquivo: string): Partial<Record<NomeSegredo, string>> {
  try {
    const bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as unknown;
    return bruto && typeof bruto === 'object' ? (bruto as Partial<Record<NomeSegredo, string>>) : {};
  } catch {
    return {};
  }
}

// Devolve o segredo pedido. Chamada na importação de config.ts (valor fixo durante a execução).
export function segredo(nome: NomeSegredo): string {
  const doAmbiente = process.env[nome] ?? '';
  if (!VALORES_DE_EXEMPLO.has(doAmbiente)) {
    return doAmbiente;
  }

  const { dir, arquivo } = arquivoSegredos();
  const gravados = lerGravados(arquivo);
  const existente = gravados[nome];
  if (typeof existente === 'string' && existente !== '') {
    avisar(nome, arquivo);
    return existente;
  }

  const novo = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(dir, { recursive: true });
  const conteudo = { ...gravados, [nome]: novo };
  fs.writeFileSync(arquivo, JSON.stringify(conteudo, null, 2), { encoding: 'utf8', mode: 0o600 });
  avisar(nome, arquivo);
  return novo;
}

function avisar(nome: NomeSegredo, arquivo: string): void {
  if (avisados.has(nome)) return;
  avisados.add(nome);
  console.warn(
    `[segredos] ${nome} não definido no ambiente; usando valor persistente em ${arquivo}. ` +
      'Defina a variável no .env para controlar o segredo.',
  );
}
