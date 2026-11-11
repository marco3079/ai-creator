import * as vscode from 'vscode';

/** Chave do token de API no armazenamento seguro do VS Code. */
const CHAVE_TOKEN = 'aiCreator.token';

export type TipoAgente = 'LLM' | 'TINYML';
export type StatusJob = 'FILA' | 'EXECUTANDO' | 'SUCESSO' | 'FALHA' | 'CANCELADO';

export interface AgenteResumo {
  id: number;
  nome: string;
  slug: string;
  descricao: string;
  tipo: TipoAgente;
  tags: string[];
  provedor: string;
  modelo: string;
  versao: number;
  atualizadoEm: string;
  projeto: { id: number; nome: string } | null;
}

export interface ProjetoResumo {
  id: number;
  nome: string;
  slug: string;
  descricao: string;
  placa: string;
  framework: string;
  atualizadoEm: string;
  totalArquivos: number;
  ultimoBuild: { id: number; status: StatusJob; criadoEm: string } | null;
}

export interface ArquivoProjeto {
  caminho: string;
  atualizadoEm: string;
  conteudo?: string;
}

export interface Build {
  id: number;
  projetoId: number;
  placa: string;
  status: StatusJob;
  tamanhoBytes: number | null;
  offset: string | null;
  criadoEm: string;
  finalizadoEm: string | null;
  log?: string;
}

/** Erro devolvido pela API (`{ erro: "..." }`) ou por falta de token. */
export class ErroApi extends Error {
  constructor(readonly status: number, mensagem: string) {
    super(mensagem);
    this.name = 'ErroApi';
  }
}

interface OpcoesRequisicao {
  corpo?: unknown;
  /** Tempo máximo em milissegundos (padrão 30 s). */
  tempoLimiteMs?: number;
}

/** Cliente HTTP do AI Creator. Usa `fetch` nativo (Node 18+), sem dependências. */
export class ClienteApi {
  constructor(private readonly segredos: vscode.SecretStorage) {}

  /** URL base sem barra final. As chamadas vão para `<url>/api/...`. */
  urlBase(): string {
    const url = vscode.workspace.getConfiguration('aiCreator').get<string>('url', 'http://localhost:8080');
    return url.replace(/\/+$/, '');
  }

  async token(): Promise<string | undefined> {
    return this.segredos.get(CHAVE_TOKEN);
  }

  async temToken(): Promise<boolean> {
    return !!(await this.token());
  }

  async definirToken(token: string): Promise<void> {
    await this.segredos.store(CHAVE_TOKEN, token.trim());
  }

  async removerToken(): Promise<void> {
    await this.segredos.delete(CHAVE_TOKEN);
  }

  /** Requisição que devolve JSON (ou `undefined` para 204). */
  async json<T>(metodo: string, caminho: string, opcoes: OpcoesRequisicao = {}): Promise<T> {
    const resposta = await this.bruto(metodo, caminho, opcoes);
    if (resposta.status === 204) {
      return undefined as T;
    }
    return (await resposta.json()) as T;
  }

  /** Requisição que devolve texto (ex.: exportação `.md`). */
  async texto(metodo: string, caminho: string, opcoes: OpcoesRequisicao = {}): Promise<string> {
    const resposta = await this.bruto(metodo, caminho, opcoes);
    return resposta.text();
  }

  /** Requisição que devolve bytes (ex.: firmware `.bin`). */
  async binario(metodo: string, caminho: string, opcoes: OpcoesRequisicao = {}): Promise<Uint8Array> {
    const resposta = await this.bruto(metodo, caminho, opcoes);
    return new Uint8Array(await resposta.arrayBuffer());
  }

  private async bruto(metodo: string, caminho: string, opcoes: OpcoesRequisicao): Promise<Response> {
    const token = await this.token();
    if (!token) {
      throw new ErroApi(401, 'Token de API não configurado. Use "AI Creator: Configurar token de API".');
    }
    const cabecalhos: Record<string, string> = { Authorization: `Bearer ${token}` };
    let corpo: string | undefined;
    if (opcoes.corpo !== undefined) {
      cabecalhos['Content-Type'] = 'application/json';
      corpo = JSON.stringify(opcoes.corpo);
    }

    let resposta: Response;
    try {
      resposta = await fetch(`${this.urlBase()}/api${caminho}`, {
        method: metodo,
        headers: cabecalhos,
        body: corpo,
        signal: AbortSignal.timeout(opcoes.tempoLimiteMs ?? 30_000),
      });
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : String(erro);
      throw new ErroApi(0, `Não foi possível conectar em ${this.urlBase()} (${motivo}).`);
    }

    if (!resposta.ok) {
      let mensagem = `Erro HTTP ${resposta.status}`;
      try {
        const dados = (await resposta.json()) as { erro?: string };
        if (dados?.erro) {
          mensagem = dados.erro;
        }
      } catch {
        // corpo não é JSON; mantém a mensagem padrão
      }
      throw new ErroApi(resposta.status, mensagem);
    }
    return resposta;
  }
}
