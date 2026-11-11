import * as vscode from 'vscode';
import { ClienteApi } from './api';
import { ArvoreAgentes, ArvoreProjetos } from './arvores';
import { registrarComandos } from './comandos';

/** Ponto de entrada da extensão AI Creator. */
export function activate(contexto: vscode.ExtensionContext): void {
  const api = new ClienteApi(contexto.secrets);
  const agentes = new ArvoreAgentes(api);
  const projetos = new ArvoreProjetos(api);
  const saida = vscode.window.createOutputChannel('AI Creator');

  contexto.subscriptions.push(
    saida,
    vscode.window.registerTreeDataProvider('aiCreator.agentes', agentes),
    vscode.window.registerTreeDataProvider('aiCreator.projetos', projetos),
    vscode.workspace.onDidChangeConfiguration((evento) => {
      if (evento.affectsConfiguration('aiCreator.url')) {
        agentes.atualizar();
        projetos.atualizar();
      }
    }),
  );

  registrarComandos(contexto, { api, agentes, projetos, saida });
}

export function deactivate(): void {
  // nada a liberar: o cliente HTTP não mantém conexões abertas
}
