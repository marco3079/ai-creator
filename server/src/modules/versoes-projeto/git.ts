import fs from 'fs';
import os from 'os';
import path from 'path';
import git from 'isomorphic-git';
import AdmZip from 'adm-zip';
import type { ArquivoVersao } from './comum';
import { validarCaminho } from '../projetos/caminhos';

// Exporta as versões de um projeto como repositório Git (um commit por versão), empacotado em .zip.

export interface VersaoParaGit {
  numero: number;
  mensagem: string;
  autorNome: string | null;
  criadoEm: Date;
  arquivos: ArquivoVersao[];
}

const EMAIL_AUTOR = 'aic@local';
const NOME_AUTOR_PADRAO = 'AI Creator';

// Caminho dentro da pasta de trabalho. Recusa qualquer destino fora da raiz (defesa extra).
function caminhoNoDisco(raiz: string, caminho: string): string {
  const destino = path.join(raiz, ...caminho.split('/'));
  if (!path.resolve(destino).startsWith(path.resolve(raiz) + path.sep)) {
    throw new Error(`Caminho fora do repositório: ${caminho}`);
  }
  return destino;
}

// Pastas .git dos arquivos do projeto não podem entrar no repositório (senão corrompem o .git real).
function ehCaminhoDeGit(caminho: string): boolean {
  return caminho.split('/').some((parte) => parte.toLowerCase() === '.git');
}

// versoes deve vir em ordem crescente de numero. Devolve o conteúdo do .zip (inclui a pasta .git).
export async function gerarZipGit(versoes: VersaoParaGit[]): Promise<Buffer> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aic-git-'));
  try {
    await git.init({ fs, dir, defaultBranch: 'main' });

    let anteriores = new Set<string>();
    for (const versao of versoes) {
      const atuais = new Set<string>();
      for (const arquivo of versao.arquivos) {
        // validarCaminho recusa "..", absolutos e "\\" (lança ErroHttp 400).
        const caminho = validarCaminho(arquivo.caminho);
        if (ehCaminhoDeGit(caminho)) {
          console.warn(`Export Git: arquivo ignorado (caminho .git): ${caminho}`);
          continue;
        }
        const destino = caminhoNoDisco(dir, caminho);
        fs.mkdirSync(path.dirname(destino), { recursive: true });
        fs.writeFileSync(destino, arquivo.conteudo, 'utf8');
        atuais.add(caminho);
      }

      for (const caminho of anteriores) {
        if (!atuais.has(caminho)) {
          fs.rmSync(caminhoNoDisco(dir, caminho), { force: true });
          await git.remove({ fs, dir, filepath: caminho });
        }
      }
      for (const caminho of atuais) {
        await git.add({ fs, dir, filepath: caminho });
      }

      await git.commit({
        fs,
        dir,
        message: versao.mensagem,
        author: {
          name: versao.autorNome?.trim() || NOME_AUTOR_PADRAO,
          email: EMAIL_AUTOR,
          timestamp: Math.floor(versao.criadoEm.getTime() / 1000),
          timezoneOffset: 0,
        },
      });
      anteriores = atuais;
    }

    const zip = new AdmZip();
    zip.addLocalFolder(dir);
    return zip.toBuffer();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
