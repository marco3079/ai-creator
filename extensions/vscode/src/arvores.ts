import * as vscode from 'vscode';
import { AgenteResumo, ClienteApi, ProjetoResumo, TipoAgente } from './api';

type ItemArvoreAgentes = GrupoAgentes | ItemAgente | ItemMensagem;
type ItemArvoreProjetos = ItemProjeto | ItemMensagem;

/** Grupo "LLM" ou "TinyML" dentro da árvore de agentes. */
export class GrupoAgentes extends vscode.TreeItem {
  constructor(readonly tipo: TipoAgente, readonly agentes: AgenteResumo[]) {
    super(
      tipo === 'LLM' ? 'Agentes LLM' : 'Agentes TinyML',
      vscode.TreeItemCollapsibleState.Expanded,
    );
    this.iconPath = new vscode.ThemeIcon(tipo === 'LLM' ? 'hubot' : 'circuit-board');
    this.description = `${agentes.length}`;
    this.contextValue = 'grupoAgentes';
  }
}

export class ItemAgente extends vscode.TreeItem {
  constructor(readonly agente: AgenteResumo) {
    super(agente.nome, vscode.TreeItemCollapsibleState.None);
    this.id = `agente-${agente.id}`;
    this.description = agente.tipo === 'LLM' ? `${agente.provedor} · ${agente.modelo}` : agente.slug;
    this.tooltip = agente.descricao || agente.nome;
    this.iconPath = new vscode.ThemeIcon(agente.tipo === 'LLM' ? 'hubot' : 'circuit-board');
    this.contextValue = 'agente';
  }
}

export class ItemProjeto extends vscode.TreeItem {
  constructor(readonly projeto: ProjetoResumo) {
    super(projeto.nome, vscode.TreeItemCollapsibleState.None);
    this.id = `projeto-${projeto.id}`;
    this.description = projeto.placa;
    this.tooltip = `${projeto.nome} · ${projeto.placa} · ${projeto.totalArquivos} arquivo(s)`;
    this.iconPath = new vscode.ThemeIcon('chip');
    this.contextValue = 'projeto';
  }
}

/** Linha informativa (sem ação): erro de conexão ou lista vazia. */
export class ItemMensagem extends vscode.TreeItem {
  constructor(texto: string, icone: string) {
    super(texto, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(icone);
    this.contextValue = 'mensagem';
  }
}

/** Árvore "Agentes": agrupa LLM e TinyML. */
export class ArvoreAgentes implements vscode.TreeDataProvider<ItemArvoreAgentes> {
  private readonly emitirMudanca = new vscode.EventEmitter<ItemArvoreAgentes | undefined | void>();
  readonly onDidChangeTreeData = this.emitirMudanca.event;

  constructor(private readonly api: ClienteApi) {}

  atualizar(): void {
    this.emitirMudanca.fire();
  }

  getTreeItem(elemento: ItemArvoreAgentes): vscode.TreeItem {
    return elemento;
  }

  async getChildren(elemento?: ItemArvoreAgentes): Promise<ItemArvoreAgentes[]> {
    if (!(await this.api.temToken())) {
      return [];
    }
    if (elemento instanceof GrupoAgentes) {
      return elemento.agentes.map((a) => new ItemAgente(a));
    }
    if (elemento) {
      return [];
    }
    try {
      const agentes = await this.api.json<AgenteResumo[]>('GET', '/agentes');
      return [
        new GrupoAgentes('LLM', agentes.filter((a) => a.tipo === 'LLM')),
        new GrupoAgentes('TINYML', agentes.filter((a) => a.tipo === 'TINYML')),
      ];
    } catch (erro) {
      return [new ItemMensagem(`Não foi possível carregar: ${mensagemDe(erro)}`, 'warning')];
    }
  }
}

/** Árvore "Projetos": uma linha por projeto, com a placa na descrição. */
export class ArvoreProjetos implements vscode.TreeDataProvider<ItemArvoreProjetos> {
  private readonly emitirMudanca = new vscode.EventEmitter<ItemArvoreProjetos | undefined | void>();
  readonly onDidChangeTreeData = this.emitirMudanca.event;

  constructor(private readonly api: ClienteApi) {}

  atualizar(): void {
    this.emitirMudanca.fire();
  }

  getTreeItem(elemento: ItemArvoreProjetos): vscode.TreeItem {
    return elemento;
  }

  async getChildren(elemento?: ItemArvoreProjetos): Promise<ItemArvoreProjetos[]> {
    if (elemento || !(await this.api.temToken())) {
      return [];
    }
    try {
      const projetos = await this.api.json<ProjetoResumo[]>('GET', '/projetos');
      return projetos.map((p) => new ItemProjeto(p));
    } catch (erro) {
      return [new ItemMensagem(`Não foi possível carregar: ${mensagemDe(erro)}`, 'warning')];
    }
  }
}

function mensagemDe(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}
