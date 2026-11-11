import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';
import { AgenteResumo, Build, ClienteApi, ProjetoResumo, ArquivoProjeto } from './api';
import { ArvoreAgentes, ArvoreProjetos, ItemAgente, ItemProjeto } from './arvores';

/** Arquivo que liga uma pasta local ao projeto do servidor. */
const ARQUIVO_VINCULO = '.aicreator.json';
/** Pastas e arquivos que nunca são enviados ao servidor. */
const IGNORADOS = new Set(['.pio', '.vscode', ARQUIVO_VINCULO]);
/** Arquivos maiores que isso não são enviados. */
const LIMITE_BYTES = 1024 * 1024;
const INTERVALO_POLLING_MS = 3_000;
const TEMPO_MAXIMO_COMPILACAO_MS = 20 * 60 * 1000;
const LINK_PIO_IDE = 'https://platformio.org/install/ide?install=vscode';

interface Vinculo {
  projetoId: number;
  slug: string;
}

interface ProjetoLocal {
  pasta: string;
  vinculo: Vinculo;
}

export interface Dependencias {
  api: ClienteApi;
  agentes: ArvoreAgentes;
  projetos: ArvoreProjetos;
  saida: vscode.OutputChannel;
}

/** Registra todos os comandos `aiCreator.*`. */
export function registrarComandos(contexto: vscode.ExtensionContext, dep: Dependencias): void {
  const registrar = (id: string, fn: (...args: unknown[]) => Promise<void>) =>
    contexto.subscriptions.push(
      vscode.commands.registerCommand(id, (...args: unknown[]) => executar(() => fn(...args))),
    );

  registrar('aiCreator.configurarToken', () => configurarToken(dep));
  registrar('aiCreator.atualizar', async () => atualizarArvores(dep));
  registrar('aiCreator.baixarAgente', (item) => baixarAgente(dep, item as ItemAgente | undefined));
  registrar('aiCreator.enviarAgente', (arg) => enviarAgente(dep, arg));
  registrar('aiCreator.baixarProjeto', (item) => baixarProjeto(dep, item as ItemProjeto | undefined));
  registrar('aiCreator.enviarProjeto', (item) => enviarProjeto(dep, item as ItemProjeto | undefined));
  registrar('aiCreator.compilar', (item) => compilar(dep, item as ItemProjeto | undefined));
  registrar('aiCreator.gravarLocal', (item) => gravarLocal(dep, item as ItemProjeto | undefined));
  registrar('aiCreator.abrirNoNavegador', (item) => abrirNoNavegador(dep, item));
}

/** Executa um comando e mostra qualquer erro como notificação do VS Code. */
async function executar(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    vscode.window.showErrorMessage(`AI Creator: ${mensagem}`);
  }
}

function atualizarArvores(dep: Dependencias): void {
  dep.agentes.atualizar();
  dep.projetos.atualizar();
}

// ---------------------------------------------------------------- token

async function configurarToken(dep: Dependencias): Promise<void> {
  const token = await vscode.window.showInputBox({
    prompt: 'Token de API do AI Creator (começa com aic_)',
    password: true,
    ignoreFocusOut: true,
    validateInput: (valor) => (valor.trim() ? undefined : 'Informe o token.'),
  });
  if (!token) {
    return;
  }
  await dep.api.definirToken(token);
  try {
    const { usuario } = await dep.api.json<{ usuario: { nome: string } }>('GET', '/auth/eu');
    vscode.window.showInformationMessage(`AI Creator: conectado como ${usuario.nome}.`);
    atualizarArvores(dep);
  } catch (erro) {
    await dep.api.removerToken();
    throw erro;
  }
}

// ---------------------------------------------------------------- agentes

async function baixarAgente(dep: Dependencias, item?: ItemAgente): Promise<void> {
  const agente = item?.agente ?? (await escolherAgente(dep.api));
  if (!agente) {
    return;
  }
  const raiz = raizObrigatoria();

  if (agente.tipo === 'LLM') {
    const md = await dep.api.texto('GET', `/agentes/${agente.id}/exportar?formato=md`);
    const destino = path.join(raiz, '.claude', 'agents', `${agente.slug}.md`);
    await fs.mkdir(path.dirname(destino), { recursive: true });
    await fs.writeFile(destino, md, 'utf8');
    const documento = await vscode.workspace.openTextDocument(destino);
    await vscode.window.showTextDocument(documento);
    vscode.window.showInformationMessage(`Agente "${agente.nome}" salvo em .claude/agents/${agente.slug}.md.`);
    return;
  }

  const json = await dep.api.texto('GET', `/agentes/${agente.id}/exportar?formato=json`);
  const destino = path.join(raiz, 'ai-creator', 'agentes', `${agente.slug}.json`);
  await fs.mkdir(path.dirname(destino), { recursive: true });
  await fs.writeFile(destino, json, 'utf8');
  vscode.window.showInformationMessage(`Agente TinyML "${agente.nome}" salvo em ai-creator/agentes/${agente.slug}.json.`);
}

async function enviarAgente(dep: Dependencias, arg?: unknown): Promise<void> {
  const raiz = raizObrigatoria();
  const pastaAgentes = path.join(raiz, '.claude', 'agents');

  let uri: vscode.Uri | undefined = arg instanceof vscode.Uri ? arg : vscode.window.activeTextEditor?.document.uri;
  if (!uri || !uri.fsPath.toLowerCase().endsWith('.md') || !uri.fsPath.startsWith(pastaAgentes)) {
    const arquivos = await vscode.workspace.findFiles(
      new vscode.RelativePattern(raiz, '.claude/agents/*.md'),
    );
    if (arquivos.length === 0) {
      throw new Error('Nenhum arquivo .md em .claude/agents/ foi encontrado.');
    }
    const escolhido = await vscode.window.showQuickPick(
      arquivos.map((a) => ({ label: path.basename(a.fsPath), uri: a })),
      { placeHolder: 'Qual agente enviar?' },
    );
    if (!escolhido) {
      return;
    }
    uri = escolhido.uri;
  }

  const documento = await vscode.workspace.openTextDocument(uri);
  const conteudo = documento.getText();
  const agente = await dep.api.json<AgenteResumo>('POST', '/agentes/importar', {
    corpo: { conteudo, formato: 'md' },
  });
  dep.agentes.atualizar();
  vscode.window.showInformationMessage(`Agente "${agente.nome}" enviado ao AI Creator (versão ${agente.versao}).`);
}

async function escolherAgente(api: ClienteApi): Promise<AgenteResumo | undefined> {
  const agentes = await api.json<AgenteResumo[]>('GET', '/agentes');
  if (agentes.length === 0) {
    throw new Error('Nenhum agente cadastrado no AI Creator.');
  }
  const escolhido = await vscode.window.showQuickPick(
    agentes.map((a) => ({ label: a.nome, description: a.tipo, agente: a })),
    { placeHolder: 'Qual agente baixar?' },
  );
  return escolhido?.agente;
}

// ---------------------------------------------------------------- projetos

async function baixarProjeto(dep: Dependencias, item?: ItemProjeto): Promise<void> {
  const projeto = item?.projeto ?? (await escolherProjeto(dep.api));
  if (!projeto) {
    return;
  }
  const pasta = caminhoProjetoLocal(projeto.slug);
  if (await existe(pasta)) {
    const confirmar = await vscode.window.showWarningMessage(
      `A pasta ${pasta} já existe. Os arquivos com o mesmo nome serão sobrescritos. Continuar?`,
      { modal: true },
      'Sobrescrever',
    );
    if (confirmar !== 'Sobrescrever') {
      return;
    }
  }

  const arquivos = await dep.api.json<ArquivoProjeto[]>('GET', `/projetos/${projeto.id}/arquivos?conteudo=1`);
  for (const arquivo of arquivos) {
    const destino = destinoSeguro(pasta, arquivo.caminho);
    await fs.mkdir(path.dirname(destino), { recursive: true });
    await fs.writeFile(destino, arquivo.conteudo ?? '', 'utf8');
  }
  const vinculo: Vinculo = { projetoId: projeto.id, slug: projeto.slug };
  await fs.writeFile(path.join(pasta, ARQUIVO_VINCULO), JSON.stringify(vinculo, null, 2) + '\n', 'utf8');
  vscode.window.showInformationMessage(`Projeto "${projeto.nome}" baixado em ${pasta} (${arquivos.length} arquivo(s)).`);
}

async function enviarProjeto(dep: Dependencias, item?: ItemProjeto): Promise<void> {
  const local = await resolverProjetoLocal(item);
  const arquivos = await lerPastaProjeto(local.pasta);
  const confirmar = await vscode.window.showWarningMessage(
    `Enviar ${arquivos.length} arquivo(s) de "${local.vinculo.slug}"? Arquivos que existem no servidor e não estão na pasta local serão REMOVIDOS do servidor.`,
    { modal: true },
    'Enviar',
  );
  if (confirmar !== 'Enviar') {
    return;
  }
  await enviarArquivos(dep.api, local, arquivos);
  vscode.window.showInformationMessage(`Projeto "${local.vinculo.slug}" enviado (${arquivos.length} arquivo(s)).`);
}

async function compilar(dep: Dependencias, item?: ItemProjeto): Promise<void> {
  const local = await resolverProjetoLocal(item);
  const arquivos = await lerPastaProjeto(local.pasta);
  await enviarArquivos(dep.api, local, arquivos);

  const build = await dep.api.json<Build>('POST', `/projetos/${local.vinculo.projetoId}/build`, { corpo: {} });
  dep.saida.appendLine(`--- Compilação #${build.id} de ${local.vinculo.slug} ---`);
  const final = await acompanharBuild(dep, build, local.vinculo.slug);

  if (final.status === 'SUCESSO') {
    const escolha = await vscode.window.showInformationMessage(
      `Compilação de "${local.vinculo.slug}" concluída.`,
      'Baixar firmware',
    );
    if (escolha === 'Baixar firmware') {
      await baixarFirmware(dep.api, final.id);
    }
    return;
  }
  const escolha = await vscode.window.showErrorMessage(
    `Compilação de "${local.vinculo.slug}" terminou com status ${final.status}.`,
    'Ver log',
  );
  if (escolha === 'Ver log') {
    dep.saida.show(true);
  }
}

async function gravarLocal(dep: Dependencias, item?: ItemProjeto): Promise<void> {
  const local = await resolverProjetoLocal(item);
  if (!(await pioDisponivel())) {
    const escolha = await vscode.window.showErrorMessage(
      'O comando "pio" não foi encontrado. Instale o PlatformIO IDE para gravar pelo computador.',
      'Instalar PlatformIO IDE',
    );
    if (escolha) {
      await vscode.env.openExternal(vscode.Uri.parse(LINK_PIO_IDE));
    }
    return;
  }

  const porta = await vscode.window.showInputBox({
    prompt: 'Porta de upload (opcional, ex.: COM3 ou /dev/ttyUSB0). Deixe vazio para detectar automaticamente.',
    ignoreFocusOut: true,
  });
  if (porta === undefined) {
    return;
  }
  if (porta.includes('"')) {
    throw new Error('A porta não pode conter aspas.');
  }

  let comando = `pio run -d "${local.pasta}" -t upload`;
  if (porta.trim()) {
    comando += ` --upload-port "${porta.trim()}"`;
  }
  const terminal = vscode.window.createTerminal({ name: `AI Creator: gravar ${local.vinculo.slug}`, cwd: local.pasta });
  terminal.show();
  terminal.sendText(comando);
}

async function abrirNoNavegador(dep: Dependencias, item?: unknown): Promise<void> {
  let caminho = '/app';
  if (item instanceof ItemAgente) {
    caminho = `/app/agentes/${item.agente.id}`;
  } else if (item instanceof ItemProjeto) {
    caminho = `/app/projetos/${item.projeto.id}`;
  }
  await vscode.env.openExternal(vscode.Uri.parse(`${dep.api.urlBase()}${caminho}`));
}

// ---------------------------------------------------------------- compilação

const TERMINAIS = new Set(['SUCESSO', 'FALHA', 'CANCELADO']);

/** Faz polling do build, escreve o log novo no canal de saída e devolve o estado final. */
async function acompanharBuild(dep: Dependencias, inicial: Build, slug: string): Promise<Build> {
  const inicio = Date.now();
  let lidoAte = 0;
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `AI Creator: compilando ${slug}`,
      cancellable: true,
    },
    async (progresso, token) => {
      for (;;) {
        const atual = await dep.api.json<Build>('GET', `/builds/${inicial.id}`);
        const log = atual.log ?? '';
        if (log.length > lidoAte) {
          dep.saida.append(log.slice(lidoAte));
          lidoAte = log.length;
        }
        if (TERMINAIS.has(atual.status)) {
          return atual;
        }
        if (token.isCancellationRequested) {
          throw new Error('Acompanhamento cancelado. A compilação continua no servidor.');
        }
        if (Date.now() - inicio > TEMPO_MAXIMO_COMPILACAO_MS) {
          throw new Error('Tempo limite de acompanhamento excedido. Veja o status no AI Creator.');
        }
        progresso.report({ message: atual.status.toLowerCase() });
        await dormir(INTERVALO_POLLING_MS);
      }
    },
  );
}

async function baixarFirmware(api: ClienteApi, buildId: number): Promise<void> {
  const destino = await vscode.window.showSaveDialog({
    defaultUri: vscode.workspace.workspaceFolders?.[0]
      ? vscode.Uri.file(path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, `firmware-build${buildId}.bin`))
      : undefined,
    saveLabel: 'Salvar firmware',
  });
  if (!destino) {
    return;
  }
  const bytes = await api.binario('GET', `/builds/${buildId}/firmware`, { tempoLimiteMs: 120_000 });
  await fs.writeFile(destino.fsPath, bytes);
  vscode.window.showInformationMessage(`Firmware salvo em ${destino.fsPath}.`);
}

// ---------------------------------------------------------------- projetos locais

async function escolherProjeto(api: ClienteApi): Promise<ProjetoResumo | undefined> {
  const projetos = await api.json<ProjetoResumo[]>('GET', '/projetos');
  if (projetos.length === 0) {
    throw new Error('Nenhum projeto cadastrado no AI Creator.');
  }
  const escolhido = await vscode.window.showQuickPick(
    projetos.map((p) => ({ label: p.nome, description: p.placa, projeto: p })),
    { placeHolder: 'Qual projeto baixar?' },
  );
  return escolhido?.projeto;
}

/**
 * Descobre a pasta local e o vínculo do projeto. Com item da árvore, usa `<pastaProjetos>/<slug>`.
 * Sem item, procura `.aicreator.json` no workspace, em <pastaProjetos>/* e nas pastas do arquivo aberto.
 */
async function resolverProjetoLocal(item?: ItemProjeto): Promise<ProjetoLocal> {
  if (item) {
    const pasta = caminhoProjetoLocal(item.projeto.slug);
    if (!(await existe(pasta))) {
      throw new Error(`Projeto "${item.projeto.nome}" não está baixado. Use "Baixar projeto" primeiro.`);
    }
    return { pasta, vinculo: { projetoId: item.projeto.id, slug: item.projeto.slug } };
  }

  const candidatos = await localizarProjetosLocais();
  if (candidatos.length === 0) {
    throw new Error('Nenhum projeto local encontrado. Use "Baixar projeto" primeiro.');
  }
  if (candidatos.length === 1) {
    return candidatos[0];
  }
  const escolhido = await vscode.window.showQuickPick(
    candidatos.map((c) => ({ label: c.vinculo.slug, description: c.pasta, local: c })),
    { placeHolder: 'Qual projeto local?' },
  );
  if (!escolhido) {
    throw new Error('Operação cancelada.');
  }
  return escolhido.local;
}

async function localizarProjetosLocais(): Promise<ProjetoLocal[]> {
  const encontrados = new Map<string, ProjetoLocal>();
  const tentar = async (pasta: string) => {
    const vinculo = await lerVinculo(pasta);
    if (vinculo) {
      encontrados.set(pasta, { pasta, vinculo });
    }
  };

  const raiz = raizWorkspace();
  const ativo = vscode.window.activeTextEditor?.document.uri.fsPath;
  if (raiz && ativo && ativo.startsWith(raiz)) {
    let atual = path.dirname(ativo);
    while (atual.startsWith(raiz)) {
      await tentar(atual);
      if (atual === raiz) {
        break;
      }
      const pai = path.dirname(atual);
      if (pai === atual) {
        break;
      }
      atual = pai;
    }
  }
  if (raiz) {
    await tentar(raiz);
    const pastaProjetos = pastaProjetosAbsoluta();
    if (pastaProjetos && (await existe(pastaProjetos))) {
      const entradas = await fs.readdir(pastaProjetos, { withFileTypes: true });
      for (const entrada of entradas) {
        if (entrada.isDirectory()) {
          await tentar(path.join(pastaProjetos, entrada.name));
        }
      }
    }
  }
  return [...encontrados.values()];
}

async function lerVinculo(pasta: string): Promise<Vinculo | undefined> {
  try {
    const dados = JSON.parse(await fs.readFile(path.join(pasta, ARQUIVO_VINCULO), 'utf8')) as Partial<Vinculo>;
    if (typeof dados.projetoId === 'number' && typeof dados.slug === 'string') {
      return { projetoId: dados.projetoId, slug: dados.slug };
    }
  } catch {
    // sem vínculo ou JSON inválido
  }
  return undefined;
}

/** Lê os arquivos da pasta do projeto, ignorando pastas de build/IDE, o vínculo e binários/arquivos grandes. */
async function lerPastaProjeto(pasta: string): Promise<{ caminho: string; conteudo: string }[]> {
  const arquivos: { caminho: string; conteudo: string }[] = [];
  const percorrer = async (dir: string): Promise<void> => {
    const entradas = await fs.readdir(dir, { withFileTypes: true });
    for (const entrada of entradas) {
      if (IGNORADOS.has(entrada.name)) {
        continue;
      }
      const completo = path.join(dir, entrada.name);
      if (entrada.isDirectory()) {
        await percorrer(completo);
      } else if (entrada.isFile()) {
        const info = await fs.stat(completo);
        if (info.size > LIMITE_BYTES) {
          continue;
        }
        const bytes = await fs.readFile(completo);
        if (bytes.includes(0)) {
          continue; // binário: não é enviado como texto
        }
        arquivos.push({
          caminho: path.relative(pasta, completo).split(path.sep).join('/'),
          conteudo: bytes.toString('utf8'),
        });
      }
    }
  };
  await percorrer(pasta);
  return arquivos;
}

/** Envia o conjunto completo de arquivos (upsert em lote, removendo os ausentes localmente). */
async function enviarArquivos(
  api: ClienteApi,
  local: ProjetoLocal,
  arquivos: { caminho: string; conteudo: string }[],
): Promise<void> {
  await api.json('PUT', `/projetos/${local.vinculo.projetoId}/arquivos`, {
    corpo: { arquivos, removerAusentes: true },
    tempoLimiteMs: 120_000,
  });
}

// ---------------------------------------------------------------- utilidades

function raizWorkspace(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function raizObrigatoria(): string {
  const raiz = raizWorkspace();
  if (!raiz) {
    throw new Error('Abra uma pasta no VS Code (File > Open Folder) antes de usar esta ação.');
  }
  return raiz;
}

function pastaProjetosAbsoluta(): string | undefined {
  const raiz = raizWorkspace();
  if (!raiz) {
    return undefined;
  }
  const relativa = vscode.workspace.getConfiguration('aiCreator').get<string>('pastaProjetos', 'ai-creator');
  return path.join(raiz, relativa);
}

function caminhoProjetoLocal(slug: string): string {
  const pastaProjetos = pastaProjetosAbsoluta();
  if (!pastaProjetos) {
    throw new Error('Abra uma pasta no VS Code (File > Open Folder) antes de usar esta ação.');
  }
  return path.join(pastaProjetos, slug);
}

/** Impede que um caminho vindo do servidor escape da pasta do projeto. */
function destinoSeguro(base: string, caminho: string): string {
  if (!caminho || path.isAbsolute(caminho) || caminho.includes('\\') || caminho.split('/').includes('..')) {
    throw new Error(`Caminho inválido no projeto: ${caminho}`);
  }
  const destino = path.resolve(base, ...caminho.split('/'));
  const relativo = path.relative(base, destino);
  if (relativo.startsWith('..') || path.isAbsolute(relativo)) {
    throw new Error(`Caminho fora da pasta do projeto: ${caminho}`);
  }
  return destino;
}

async function existe(caminho: string): Promise<boolean> {
  try {
    await fs.access(caminho);
    return true;
  } catch {
    return false;
  }
}

/** Verifica se o comando `pio` (PlatformIO) responde no terminal. */
function pioDisponivel(): Promise<boolean> {
  return new Promise((resolver) => {
    const processo = spawn('pio --version', { shell: true, windowsHide: true });
    processo.on('error', () => resolver(false));
    processo.on('close', (codigo) => resolver(codigo === 0));
  });
}

function dormir(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}
