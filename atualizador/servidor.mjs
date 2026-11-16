// Atualizador do AI Creator.
// Baixa o último commit do GitHub (ramo atual, só avanço rápido), copia o banco antes, reconstrói só os
// serviços que mudaram e os reinicia. Sem dependências npm. Não publica porta: só o servidor fala com ele,
// pela rede interna do Compose.
import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';

const PORTA = 4000;
// Os caminhos podem ser trocados por variáveis de ambiente (testes fora do contêiner); no contêiner valem os padrões.
const PASTA_PROJETO = process.env.ATUALIZADOR_PROJETO || '/projeto';
const ARQ_COMPOSE = path.join(PASTA_PROJETO, 'docker-compose.yml');
const PASTA_BACKUPS = path.join(PASTA_PROJETO, 'backups');
const PASTA_DADOS = process.env.ATUALIZADOR_DADOS || '/dados';
const ARQ_IMPLANTADO = path.join(PASTA_DADOS, 'implantado');
const ARQ_TAREFA = path.join(PASTA_DADOS, 'tarefa.json');
const ARQ_SEGREDOS = process.env.ATUALIZADOR_SEGREDOS || '/servidor/segredos.json';
const PASTA_APP = process.env.ATUALIZADOR_APP || '/app';
const ARQ_APP_SERVIDOR = path.join(PASTA_APP, 'servidor.mjs');
const ARQ_APP_DOCKERFILE = path.join(PASTA_APP, 'Dockerfile');
const ARQ_PROJ_SERVIDOR = path.join(PASTA_PROJETO, 'atualizador', 'servidor.mjs');
const ARQ_PROJ_DOCKERFILE = path.join(PASTA_PROJETO, 'atualizador', 'Dockerfile');
const PROJETO = (process.env.PROJETO_COMPOSE ?? '').trim() || 'ai-creator';

const MINUTO = 60 * 1000;
// Folgas largas: em pasta sincronizada ou com o Docker ocupado, o Git pode levar dezenas de segundos.
const TEMPO_LEITURA = 30 * 1000;
const TEMPO_VERIFICAR = 45 * 1000;
const TEMPO_GIT = 5 * MINUTO;
const TEMPO_BANCO = 15 * MINUTO;
const TEMPO_BUILD = 20 * MINUTO;
const TEMPO_UP = 5 * MINUTO;
const ATRASO_PRIMEIRA_VERIFICACAO = MINUTO;
const INTERVALO_VERIFICACAO = 6 * 60 * MINUTO;
const MAX_LOG = 200;
const MAX_LINHA = 500;
const MAX_NOVIDADES = 20;
const MAX_COPIAS = 5;
const MAX_BUFFER_LINHA = 64 * 1024;
const MAX_SAIDA_COLETADA = 256 * 1024;
const ESTADOS = ['PARADA', 'EXECUTANDO', 'CONCLUIDA', 'FALHOU'];
const ETAPA_BANCO = 'Copiando o banco';
const ETAPA_BAIXAR = 'Baixando o código';
const ETAPA_RECONSTRUIR = 'Reconstruindo';
const ETAPA_REINICIAR = 'Reiniciando';
const SEGREDOS_DE_EXEMPLO = ['troque-este-segredo', 'troque-este-segredo-de-exemplo'];
const HASH_COMMIT = /^[0-9a-f]{40,64}$/;
const PADRAO_COPIA = /^aicreator-\d{8}-\d{6}\.sql$/;
const ORDEM_SERVICOS = ['server', 'client', 'trainer', 'builder', 'finetuner', 'mosquitto'];
// Prefixo de pasta -> serviço que precisa de build (finetuner só entra se estiver rodando).
const PREFIXOS_BUILD = [
  ['server/', 'server'],
  ['client/', 'client'],
  ['trainer/', 'trainer'],
  ['builder/', 'builder'],
  ['finetuner/', 'finetuner'],
  ['mosquitto/', 'mosquitto'],
];
// Nunca sobem pelo "docker-compose.yml" mudou: o próprio atualizador e o banco.
const SERVICOS_FORA_DO_UP = ['atualizador', 'db'];
// Sem commit implantado conhecido: reconstrói estes (+ finetuner se estiver rodando).
const SERVICOS_PADRAO = ['server', 'client', 'trainer', 'builder'];

let tarefa = tarefaInicial();
let implantado = null; // commit completo em execução
let verificacao = { em: null, erro: null };
let segredoGravado = ''; // JWT_SECRET lido de segredos.json (guardado depois do primeiro acerto)

// ---------- utilidades ----------

function agora() {
  return new Date().toISOString();
}

// Carimbo UTC no formato AAAAMMDD-HHMMSS (usado no nome das cópias do banco).
function carimboUtc(data = new Date()) {
  return data.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
}

// "aicreator-20261116-123456.sql" -> "2026-11-16T12:34:56Z"
function instanteDoNomeDaCopia(nome) {
  const m = /^aicreator-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.sql$/.exec(nome);
  if (!m) return null;
  return m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6] + 'Z';
}

function registrar(mensagem) {
  console.error('[' + agora() + '] ' + mensagem);
}

function textoErro(erro) {
  if (erro && typeof erro.message === 'string') return erro.message;
  return String(erro);
}

function cortar(texto, limite) {
  const s = String(texto);
  return s.length > limite ? s.slice(0, limite) : s;
}

// Remove "usuario:senha@" (ou só "token@") de endereços com esquema, por exemplo https://...
function ocultarCredenciais(texto) {
  return String(texto).replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1');
}

function tarefaInicial() {
  return { estado: 'PARADA', etapa: '', iniciadaEm: null, terminadaEm: null, erro: null, log: [] };
}

function adicionarLog(linha) {
  tarefa.log.push(cortar(ocultarCredenciais(linha), MAX_LINHA));
  if (tarefa.log.length > MAX_LOG) {
    tarefa.log.splice(0, tarefa.log.length - MAX_LOG);
  }
}

function ambienteFilho() {
  // Ambiente mínimo: o segredo do atualizador não é repassado aos comandos filhos.
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME || '/root',
    LANG: 'C.UTF-8',
    GIT_TERMINAL_PROMPT: '0',
  };
  if (process.env.DOCKER_HOST) env.DOCKER_HOST = process.env.DOCKER_HOST;
  for (const chave of Object.keys(env)) {
    if (env[chave] === undefined) delete env[chave];
  }
  return env;
}

// Roda um programa sem shell: argumentos sempre em lista. Nunca rejeita; devolve o resultado.
// Com `destinoSaida` (descritor de arquivo aberto), a saída padrão vai direto para o arquivo.
function executar(programa, argumentos, opcoes = {}) {
  const { tempoLimite, aoLinha, destinoSaida } = opcoes;
  return new Promise((resolver) => {
    let concluido = false;
    let expirou = false;
    let temporizador = null;
    let saidaPadrao = '';
    const ultimas = [];

    const finalizar = (resultado) => {
      if (concluido) return;
      concluido = true;
      if (temporizador) clearTimeout(temporizador);
      resolver({ codigo: -1, erro: null, ...resultado, expirou, ultimas, saida: saidaPadrao });
    };

    let filho;
    try {
      filho = spawn(programa, argumentos, {
        env: ambienteFilho(),
        shell: false,
        windowsHide: true,
        stdio: ['ignore', destinoSaida ?? 'pipe', 'pipe'],
      });
    } catch (erro) {
      finalizar({ erro: textoErro(erro) });
      return;
    }

    const criarLeitor = (padrao) => {
      const decodificador = new StringDecoder('utf8');
      let resto = '';
      const emitir = (linha) => {
        const limpa = linha.replace(/\r$/, '');
        ultimas.push(ocultarCredenciais(limpa));
        if (ultimas.length > 5) ultimas.shift();
        if (aoLinha) {
          try {
            aoLinha(limpa);
          } catch {
            // o registro de log nunca derruba a execução
          }
        }
      };
      return {
        receber(bloco) {
          const texto = decodificador.write(bloco);
          if (padrao && saidaPadrao.length < MAX_SAIDA_COLETADA) saidaPadrao += texto;
          resto += texto;
          let pos;
          while ((pos = resto.indexOf('\n')) !== -1) {
            emitir(resto.slice(0, pos));
            resto = resto.slice(pos + 1);
          }
          if (resto.length > MAX_BUFFER_LINHA) {
            emitir(resto);
            resto = '';
          }
        },
        fim() {
          resto += decodificador.end();
          if (resto) {
            emitir(resto);
            resto = '';
          }
        },
      };
    };

    const leitorSaida = destinoSaida === undefined ? criarLeitor(true) : null;
    const leitorErro = criarLeitor(false);
    if (leitorSaida) {
      filho.stdout.on('data', (bloco) => leitorSaida.receber(bloco));
      filho.stdout.on('error', () => {});
    }
    filho.stderr.on('data', (bloco) => leitorErro.receber(bloco));
    filho.stderr.on('error', () => {});

    if (tempoLimite) {
      temporizador = setTimeout(() => {
        expirou = true;
        try {
          filho.kill('SIGKILL');
        } catch {
          // já encerrado
        }
      }, tempoLimite);
    }

    filho.on('error', (erro) => {
      finalizar({ erro: textoErro(erro) });
    });
    filho.on('close', (codigo) => {
      leitorSaida?.fim();
      leitorErro.fim();
      finalizar({ codigo: codigo ?? -1 });
    });
  });
}

// Git e a tarefa usam a mesma fila: nada de dois comandos Git ao mesmo tempo no repositório.
let filaGit = Promise.resolve();
function comGitExclusivo(funcao) {
  const resultado = filaGit.then(funcao);
  filaGit = resultado.catch(() => {});
  return resultado;
}

function git(argumentos, opcoes) {
  return executar('git', ['-C', PASTA_PROJETO, ...argumentos], opcoes);
}

// Comando do Compose do projeto. O perfil gpu entra quando o finetuner está na lista.
function comandoCompose(gpu, argumentos) {
  return ['compose', '-p', PROJETO, '-f', ARQ_COMPOSE, ...(gpu ? ['--profile', 'gpu'] : []), ...argumentos];
}

function ramoValido(ramo) {
  return (
    typeof ramo === 'string' &&
    ramo.length > 0 &&
    ramo.length <= 200 &&
    ramo !== 'HEAD' &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ramo) &&
    !ramo.includes('..') &&
    !ramo.endsWith('/') &&
    !ramo.endsWith('.lock')
  );
}

async function lerArquivo(nome) {
  try {
    return await fs.readFile(nome, 'utf8');
  } catch {
    return null;
  }
}

async function gravarArquivo(nome, conteudo) {
  try {
    await fs.mkdir(PASTA_DADOS, { recursive: true });
    const temporario = nome + '.tmp';
    await fs.writeFile(temporario, conteudo, 'utf8');
    await fs.rename(temporario, nome);
    return true;
  } catch (erro) {
    registrar('Não foi possível gravar ' + nome + ': ' + textoErro(erro));
    return false;
  }
}

async function persistirTarefa() {
  await gravarArquivo(ARQ_TAREFA, JSON.stringify(tarefa));
}

// ---------- token ----------

function segredoUtil(valor) {
  const texto = typeof valor === 'string' ? valor.trim() : '';
  return texto !== '' && !SEGREDOS_DE_EXEMPLO.includes(texto);
}

// JWT_SECRET efetivo: o do ambiente se não for valor de exemplo; senão o de /servidor/segredos.json.
// Relê o arquivo a cada pedido enquanto ainda não tiver o segredo (o servidor pode criá-lo depois).
async function segredoEfetivo() {
  const doAmbiente = process.env.JWT_SECRET ?? '';
  if (segredoUtil(doAmbiente)) return doAmbiente.trim();
  if (segredoGravado) return segredoGravado;
  try {
    const lido = JSON.parse(await fs.readFile(ARQ_SEGREDOS, 'utf8'));
    if (lido && typeof lido === 'object' && segredoUtil(lido.JWT_SECRET)) {
      segredoGravado = lido.JWT_SECRET.trim();
    }
  } catch {
    // arquivo ainda não existe ou não é JSON: sem segredo por enquanto
  }
  return segredoGravado;
}

// Token esperado: sha256('atualizador:' + segredo) em hexadecimal. Sem segredo: null (todo pedido recebe 401).
async function tokenEsperado() {
  const segredo = await segredoEfetivo();
  if (!segredo) return null;
  return crypto.createHash('sha256').update('atualizador:' + segredo).digest('hex');
}

// ---------- leitura do Git ----------

async function lerRamo() {
  const r = await git(['rev-parse', '--abbrev-ref', 'HEAD'], { tempoLimite: TEMPO_LEITURA });
  if (r.codigo !== 0) return null;
  const ramo = r.saida.trim();
  return ramoValido(ramo) ? ramo : null;
}

function interpretarCommit(linha) {
  const partes = String(linha ?? '').replace(/\r$/, '').split('\x1f');
  if (partes.length < 3 || !HASH_COMMIT.test(partes[0])) return null;
  return {
    commit: partes[0],
    curto: partes[0].slice(0, 7),
    data: partes[1],
    mensagem: partes[2],
  };
}

async function lerCommit(referencia) {
  const r = await git(['log', '-1', '--format=%H%x1f%cI%x1f%s', referencia, '--'], {
    tempoLimite: TEMPO_LEITURA,
  });
  if (r.codigo !== 0) return null;
  return interpretarCommit(r.saida.split('\n')[0]);
}

async function lerRepositorio() {
  const r = await git(['remote', 'get-url', 'origin'], { tempoLimite: TEMPO_LEITURA });
  if (r.codigo !== 0) return null;
  const url = r.saida.split('\n')[0].trim();
  return url ? ocultarCredenciais(url) : null;
}

async function lerNovidades(ramo) {
  const r = await git(
    ['log', '--max-count=' + MAX_NOVIDADES, '--format=%H%x1f%cI%x1f%s', 'HEAD..origin/' + ramo, '--'],
    { tempoLimite: TEMPO_LEITURA }
  );
  if (r.codigo !== 0) return [];
  const novidades = [];
  for (const linha of r.saida.split('\n')) {
    const commit = interpretarCommit(linha);
    if (commit) {
      novidades.push({ curto: commit.curto, mensagem: commit.mensagem, data: commit.data });
    }
  }
  return novidades;
}

async function contarAtras(ramo) {
  const r = await git(['rev-list', '--count', 'HEAD..origin/' + ramo, '--'], { tempoLimite: TEMPO_LEITURA });
  if (r.codigo !== 0) return 0;
  const numero = parseInt(r.saida.trim(), 10);
  return Number.isFinite(numero) && numero > 0 ? numero : 0;
}

// Arquivos que mudam entre `base` e `referencia` (git diff --name-only). Falha: null.
async function arquivosAlterados(base, referencia) {
  const r = await git(['diff', '--name-only', base + '..' + referencia, '--'], { tempoLimite: TEMPO_LEITURA });
  if (r.codigo !== 0) return null;
  return r.saida
    .split('\n')
    .map((linha) => linha.replace(/\r$/, '').trim())
    .filter((linha) => linha !== '');
}

// Hash SHA-256 do conteúdo com fim de linha normalizado (CRLF vira LF). Arquivo ausente: null.
async function hashNormalizado(nome) {
  try {
    const bruto = await fs.readFile(nome, 'utf8');
    return crypto.createHash('sha256').update(bruto.replace(/\r\n/g, '\n')).digest('hex');
  } catch {
    return null;
  }
}

async function arquivoDiferente(usado, atual) {
  const a = await hashNormalizado(usado);
  const b = await hashNormalizado(atual);
  if (a === null || b === null) return false;
  return a !== b;
}

// Compara o código em execução (/app) com o do checkout (/projeto/atualizador).
async function atualizadorMudou() {
  try {
    if (await arquivoDiferente(ARQ_APP_SERVIDOR, ARQ_PROJ_SERVIDOR)) return true;
    return await arquivoDiferente(ARQ_APP_DOCKERFILE, ARQ_PROJ_DOCKERFILE);
  } catch {
    return false;
  }
}

// ---------- Docker e cópias do banco ----------

// Ordem de exibição: server, client, trainer, builder, finetuner, mosquitto e o resto em ordem alfabética.
function ordenarServicos(lista) {
  const posicao = (s) => (ORDEM_SERVICOS.indexOf(s) === -1 ? ORDEM_SERVICOS.length : ORDEM_SERVICOS.indexOf(s));
  return [...new Set(lista)].sort((a, b) => posicao(a) - posicao(b) || (a < b ? -1 : a > b ? 1 : 0));
}

// Função pura: quais serviços reconstruir (build) e quais só reiniciar (soUp), dado o que mudou.
export function servicosParaAtualizar(arquivosAlterados, rodando, implantadoConhecido) {
  const rodandoSet = new Set(Array.isArray(rodando) ? rodando : []);
  if (!implantadoConhecido) {
    const build = [...SERVICOS_PADRAO];
    if (rodandoSet.has('finetuner')) build.push('finetuner');
    const buildOrdenado = ordenarServicos(build);
    return { build: buildOrdenado, soUp: [], precisaPerfilGpu: buildOrdenado.includes('finetuner') };
  }

  const build = new Set();
  const soUp = new Set();
  for (const bruto of Array.isArray(arquivosAlterados) ? arquivosAlterados : []) {
    const arquivo = String(bruto).replace(/\\/g, '/').replace(/^\.\//, '');
    for (const [prefixo, servico] of PREFIXOS_BUILD) {
      if (!arquivo.startsWith(prefixo)) continue;
      if (servico === 'finetuner' && !rodandoSet.has('finetuner')) continue;
      build.add(servico);
    }
    if (arquivo === 'docker-compose.yml') {
      for (const servico of rodandoSet) {
        if (!SERVICOS_FORA_DO_UP.includes(servico)) soUp.add(servico);
      }
    }
  }
  // Quem já vai ser reconstruído não entra de novo na lista só de reinício.
  for (const servico of build) soUp.delete(servico);

  const buildOrdenado = ordenarServicos([...build]);
  const soUpOrdenado = ordenarServicos([...soUp]);
  return {
    build: buildOrdenado,
    soUp: soUpOrdenado,
    precisaPerfilGpu: buildOrdenado.includes('finetuner') || soUpOrdenado.includes('finetuner'),
  };
}

// Função pura: serviços da lista que têm volume do tipo bind no `docker compose config --format json`.
// Bind relativo não funciona aqui (o Compose roda dentro do atualizador), então a atualização para.
export function servicosComBind(configJson, lista) {
  const config = typeof configJson === 'string' ? JSON.parse(configJson) : configJson;
  const servicos = config && typeof config === 'object' && config.services && typeof config.services === 'object'
    ? config.services
    : {};
  return (Array.isArray(lista) ? lista : []).filter((nome) => {
    const volumes = servicos[nome] && Array.isArray(servicos[nome].volumes) ? servicos[nome].volumes : [];
    return volumes.some((volume) => volume && volume.type === 'bind');
  });
}

// Serviços rodando agora. `falhou` indica que o Docker não respondeu (o resultado vai junto para a mensagem).
async function servicosRodando() {
  if (!PROJETO) return { falhou: false, lista: [], resultado: null };
  const r = await executar('docker', comandoCompose(false, ['ps', '--services', '--status', 'running']), {
    tempoLimite: TEMPO_LEITURA,
  });
  if (r.codigo !== 0 || r.erro || r.expirou) return { falhou: true, lista: [], resultado: r };
  const lista = r.saida
    .split('\n')
    .map((linha) => linha.replace(/\r$/, '').trim())
    .filter((linha) => linha !== '');
  return { falhou: false, lista, resultado: r };
}

// Serviços que a atualização prevê para o remoto atual (usado no estado, para a tela).
async function servicosPrevistos(ramo, remoto) {
  if (!remoto) return [];
  if (implantado !== null && implantado === remoto.commit) return [];
  let arquivos = null;
  if (implantado !== null && ramo) arquivos = await arquivosAlterados(implantado, 'origin/' + ramo);
  const rodando = await servicosRodando();
  const plano = servicosParaAtualizar(arquivos ?? [], rodando.lista, arquivos !== null);
  return ordenarServicos([...plano.build, ...plano.soUp]);
}

// Cópias do banco na pasta de backups, da mais recente para a mais antiga.
async function nomesDasCopias() {
  let nomes;
  try {
    nomes = await fs.readdir(PASTA_BACKUPS);
  } catch {
    return [];
  }
  return nomes.filter((nome) => PADRAO_COPIA.test(nome)).sort().reverse();
}

async function listarCopias() {
  const copias = [];
  for (const nome of await nomesDasCopias()) {
    try {
      const info = await fs.stat(path.join(PASTA_BACKUPS, nome));
      copias.push({ nome, tamanhoBytes: info.size, criadoEm: instanteDoNomeDaCopia(nome) ?? '' });
    } catch {
      // arquivo sumiu no meio da leitura: ignora
    }
  }
  return copias;
}

// Mantém só as MAX_COPIAS mais recentes (apaga apenas arquivos que batem com o padrão).
async function podarCopias() {
  const nomes = await nomesDasCopias();
  for (const nome of nomes.slice(MAX_COPIAS)) {
    try {
      await fs.rm(path.join(PASTA_BACKUPS, nome), { force: true });
      adicionarLog('Cópia antiga removida: ' + nome);
    } catch (erro) {
      adicionarLog('Aviso: não foi possível remover ' + nome + ': ' + textoErro(erro));
    }
  }
}

// ---------- estado ----------

// Durante a atualização os comandos Git esperam a vez na fila (a tarefa a ocupa por minutos).
// Para a tela acompanhar o progresso sem travar, devolve as informações do Git já conhecidas
// e só a tarefa atualizada.
let ultimoEstado = null;
// Verdadeiro enquanto um `git fetch` de verificação está rodando (as leituras esperariam por ele).
let verificandoAgora = false;
// Verdadeiro desde o pedido de verificação até o `git fetch` terminar (inclui a espera na fila).
let verificacaoPendente = false;
// Instante e estado da tarefa em que `ultimoEstado` foi lido: por 10 s, sem mudança na tarefa, a
// resposta vem da memória (cada comando Git pode levar segundos em pasta montada pelo Docker).
let ultimoEstadoEm = 0;
let ultimoEstadoTarefa = '';
const VALIDADE_ESTADO_MS = 10 * 1000;

async function montarEstado(forcar = false) {
  const recente =
    !forcar && Date.now() - ultimoEstadoEm < VALIDADE_ESTADO_MS && ultimoEstadoTarefa === tarefa.estado;
  if ((tarefa.estado === 'EXECUTANDO' || verificandoAgora || verificacaoPendente || recente) && ultimoEstado) {
    return {
      ...ultimoEstado,
      implantado,
      tarefa: {
        estado: tarefa.estado,
        etapa: tarefa.etapa,
        iniciadaEm: tarefa.iniciadaEm,
        terminadaEm: tarefa.terminadaEm,
        erro: tarefa.erro,
        log: [...tarefa.log],
      },
    };
  }
  ultimoEstado = await montarEstadoCompleto();
  ultimoEstadoEm = Date.now();
  ultimoEstadoTarefa = tarefa.estado;
  return ultimoEstado;
}

async function montarEstadoCompleto() {
  // O instalador regrava este arquivo quando reconstrói tudo por fora do botão: relê a cada consulta.
  try {
    const lido = ((await lerArquivo(ARQ_IMPLANTADO)) ?? '').trim();
    if (HASH_COMMIT.test(lido)) implantado = lido;
  } catch {
    // segue com o valor em memória
  }
  const ramo = await lerRamo();
  const repositorio = await lerRepositorio();
  const instalado = await lerCommit('HEAD');
  let remoto = null;
  let atras = 0;
  let novidades = [];
  if (ramo) {
    remoto = await lerCommit('origin/' + ramo);
    if (remoto) {
      atras = await contarAtras(ramo);
      novidades = await lerNovidades(ramo);
    }
  }
  const precisaReconstruir =
    implantado !== null && instalado !== null && implantado !== instalado.commit;
  return {
    ramo,
    repositorio,
    instalado,
    implantado,
    remoto,
    atras,
    novidades,
    precisaReconstruir,
    atualizadorMudou: await atualizadorMudou(),
    servicos: await servicosPrevistos(ramo, remoto),
    copias: await listarCopias(),
    verificadoEm: verificacao.em,
    erroVerificacao: verificacao.erro,
    tarefa: {
      estado: tarefa.estado,
      etapa: tarefa.etapa,
      iniciadaEm: tarefa.iniciadaEm,
      terminadaEm: tarefa.terminadaEm,
      erro: tarefa.erro,
      log: [...tarefa.log],
    },
  };
}

// ---------- verificação (git fetch) ----------

function resumoFalha(r) {
  const linhas = (r.ultimas ?? []).filter((l) => l.trim() !== '');
  if (r.erro) return cortar(ocultarCredenciais(r.erro), 300);
  // Prefere a linha que começa com "fatal:" ou "error:" (a causa), e não a última linha do Git.
  const causa = linhas.find((l) => /^(fatal|error):/i.test(l.trim()));
  return cortar(causa ?? (linhas.length ? linhas[linhas.length - 1] : 'código ' + r.codigo), 300);
}

async function verificarRemoto() {
  verificandoAgora = true;
  try {
    await verificarRemotoDeFato();
  } finally {
    verificandoAgora = false;
  }
}

async function verificarRemotoDeFato() {
  const em = agora();
  const ramo = await lerRamo();
  if (!ramo) {
    verificacao = {
      em,
      erro: 'A pasta do projeto não está em um ramo do Git. Instale de novo com git clone.',
    };
    return;
  }
  const r = await git(['fetch', '--prune', 'origin', ramo], { tempoLimite: TEMPO_VERIFICAR });
  if (r.codigo === 0) {
    verificacao = { em, erro: null };
  } else if (r.expirou) {
    verificacao = { em, erro: 'O GitHub não respondeu a tempo (30 segundos).' };
  } else {
    verificacao = { em, erro: 'Não foi possível buscar as novidades no GitHub: ' + resumoFalha(r) };
  }
}

// Verificação automática (na subida e a cada 6 h): não bloqueia o /estado e não roda durante uma atualização.
function verificarEmSegundoPlano() {
  if (verificacaoPendente) return;
  if (tarefa.estado === 'EXECUTANDO') {
    registrar('Verificação automática adiada: há uma atualização em andamento.');
    return;
  }
  verificacaoPendente = true;
  comGitExclusivo(verificarRemoto)
    .catch((erro) => registrar('Erro na verificação automática: ' + ocultarCredenciais(textoErro(erro))))
    .finally(() => {
      verificacaoPendente = false;
      ultimoEstadoEm = 0; // força a releitura na próxima consulta
    });
}

function agendarVerificacoes() {
  setTimeout(verificarEmSegundoPlano, ATRASO_PRIMEIRA_VERIFICACAO);
  setInterval(verificarEmSegundoPlano, INTERVALO_VERIFICACAO);
}

// ---------- atualização (tarefa) ----------

async function definirEtapa(nome) {
  tarefa.etapa = nome;
  await persistirTarefa();
}

async function falharTarefa(etapa, r) {
  let motivo;
  if (r.expirou) motivo = 'tempo limite excedido';
  else if (r.erro) motivo = r.erro;
  else motivo = 'o comando terminou com código ' + r.codigo;
  const ultimas = (r.ultimas ?? []).filter((l) => l.trim() !== '').slice(-5).join(' | ');
  let erro = 'Falha na etapa "' + etapa + '": ' + motivo + '.';
  if (ultimas) erro += ' Últimas linhas: ' + ultimas;
  tarefa.estado = 'FALHOU';
  tarefa.etapa = etapa;
  tarefa.erro = cortar(ocultarCredenciais(erro), 1000);
  tarefa.terminadaEm = agora();
  await persistirTarefa();
}

// Roda um comando da etapa; se falhar, marca a tarefa como FALHOU e devolve false.
async function rodarComando(etapa, comando) {
  adicionarLog('$ ' + comando.exibir);
  const r = await comando.executar();
  if (r.codigo !== 0 || r.erro || r.expirou) {
    await falharTarefa(etapa, r);
    return false;
  }
  return true;
}

// Copia o banco (pg_dump) para backups/ antes de qualquer mudança no código. Falhou: para a atualização.
async function copiarBanco() {
  await definirEtapa(ETAPA_BANCO);
  try {
    await fs.mkdir(PASTA_BACKUPS, { recursive: true });
  } catch (erro) {
    await falharTarefa(ETAPA_BANCO, { erro: 'não foi possível criar a pasta backups: ' + textoErro(erro) });
    return false;
  }
  const nome = 'aicreator-' + carimboUtc() + '.sql';
  const destino = path.join(PASTA_BACKUPS, nome);
  const parcial = destino + '.parcial';
  adicionarLog('$ docker compose -p ' + PROJETO + ' exec -T db pg_dump -U aicreator -d aicreator --no-owner > backups/' + nome);

  let r;
  let descritor;
  try {
    descritor = fsSync.openSync(parcial, 'w');
    r = await executar(
      'docker',
      comandoCompose(false, ['exec', '-T', 'db', 'pg_dump', '-U', 'aicreator', '-d', 'aicreator', '--no-owner']),
      { tempoLimite: TEMPO_BANCO, aoLinha: adicionarLog, destinoSaida: descritor }
    );
  } catch (erro) {
    r = { codigo: -1, erro: textoErro(erro), ultimas: [] };
  } finally {
    if (descritor !== undefined) {
      try {
        fsSync.closeSync(descritor);
      } catch {
        // já fechado
      }
    }
  }

  let tamanho = 0;
  if (!r.erro && !r.expirou && r.codigo === 0) {
    try {
      tamanho = (await fs.stat(parcial)).size;
    } catch {
      tamanho = 0;
    }
  }
  if (r.codigo !== 0 || r.erro || r.expirou || tamanho === 0) {
    await fs.rm(parcial, { force: true }).catch(() => {});
    const motivo = r.codigo === 0 && !r.erro && !r.expirou ? { erro: 'o arquivo do banco ficou vazio', ultimas: r.ultimas } : r;
    await falharTarefa(ETAPA_BANCO, motivo);
    return false;
  }
  try {
    await fs.rename(parcial, destino);
  } catch (erro) {
    await fs.rm(parcial, { force: true }).catch(() => {});
    await falharTarefa(ETAPA_BANCO, { erro: 'não foi possível salvar a cópia: ' + textoErro(erro), ultimas: [] });
    return false;
  }
  adicionarLog('Cópia salva: backups/' + nome + ' (' + tamanho + ' bytes).');
  await podarCopias();
  return true;
}

async function rodarAtualizacao() {
  try {
    if (!(await copiarBanco())) return;

    // Preenchido na etapa de download: o que mudou entre o implantado e o remoto, antes do pull.
    let mudancas = { arquivos: [], conhecido: false };
    const baixou = await comGitExclusivo(async () => {
      await definirEtapa(ETAPA_BAIXAR);
      const ramo = await lerRamo();
      if (!ramo) {
        await falharTarefa(ETAPA_BAIXAR, {
          erro: 'A pasta do projeto não está em um ramo do Git (commit solto ou sem ramo).',
        });
        return false;
      }
      const base = implantado;
      if (!(await rodarComando(ETAPA_BAIXAR, {
        exibir: 'git fetch --prune origin ' + ramo,
        executar: () => git(['fetch', '--prune', 'origin', ramo], { tempoLimite: TEMPO_GIT, aoLinha: adicionarLog }),
      }))) {
        return false;
      }
      const arquivos = base !== null ? await arquivosAlterados(base, 'origin/' + ramo) : null;
      if (arquivos === null) {
        adicionarLog(
          base === null
            ? 'Commit implantado desconhecido: serão reconstruídos os serviços padrão.'
            : 'Não foi possível listar o que mudou: serão reconstruídos os serviços padrão.'
        );
      }
      mudancas = { arquivos: arquivos ?? [], conhecido: arquivos !== null };
      return rodarComando(ETAPA_BAIXAR, {
        exibir: 'git pull --ff-only origin ' + ramo,
        executar: () => git(['pull', '--ff-only', 'origin', ramo], { tempoLimite: TEMPO_GIT, aoLinha: adicionarLog }),
      });
    });
    if (!baixou) return;

    // Reconstrói só o que mudou. Lista vazia: pula o build e registra.
    await definirEtapa(ETAPA_RECONSTRUIR);
    const rodando = await servicosRodando();
    if (rodando.falhou) {
      adicionarLog('$ docker compose -p ' + PROJETO + ' ps --services --status running');
      await falharTarefa(ETAPA_RECONSTRUIR, rodando.resultado);
      return;
    }
    const plano = servicosParaAtualizar(mudancas.arquivos, rodando.lista, mudancas.conhecido);
    adicionarLog('Serviços a reconstruir: ' + (plano.build.join(' ') || 'nenhum'));
    adicionarLog('Serviços a só reiniciar: ' + (plano.soUp.join(' ') || 'nenhum'));

    // Guarda: nenhum serviço da lista pode ter bind mount (o Compose roda dentro do atualizador).
    const lista = ordenarServicos([...plano.build, ...plano.soUp]);
    if (lista.length > 0) {
      const configurado = await executar('docker', comandoCompose(plano.precisaPerfilGpu, ['config', '--format', 'json']), {
        tempoLimite: TEMPO_LEITURA,
      });
      adicionarLog('$ docker compose -p ' + PROJETO + ' config --format json');
      if (configurado.codigo !== 0 || configurado.erro || configurado.expirou) {
        await falharTarefa(ETAPA_RECONSTRUIR, configurado);
        return;
      }
      let comBind = [];
      try {
        comBind = servicosComBind(configurado.saida, lista);
      } catch (erro) {
        await falharTarefa(ETAPA_RECONSTRUIR, { erro: 'não foi possível ler a configuração do Compose: ' + textoErro(erro) });
        return;
      }
      if (comBind.length > 0) {
        await falharTarefa(ETAPA_RECONSTRUIR, {
          erro: 'O serviço ' + comBind[0] + ' usa bind mount; atualize pelo terminal com atualizar.ps1 ou atualizar.sh',
        });
        return;
      }
    }

    if (plano.build.length === 0) {
      adicionarLog('Nenhum serviço precisou ser reconstruído.');
    } else {
      const reconstruiu = await rodarComando(ETAPA_RECONSTRUIR, {
        exibir: 'docker compose -p ' + PROJETO + (plano.precisaPerfilGpu ? ' --profile gpu' : '') + ' build ' + plano.build.join(' '),
        executar: () =>
          executar('docker', comandoCompose(plano.precisaPerfilGpu, ['build', ...plano.build]), {
            tempoLimite: TEMPO_BUILD,
            aoLinha: adicionarLog,
          }),
      });
      if (!reconstruiu) return;
    }

    // Reinicia os que foram reconstruídos e os que só precisam de reinício. Mosquitto sempre recriado.
    await definirEtapa(ETAPA_REINICIAR);
    if (lista.length === 0) {
      adicionarLog('Nenhum serviço precisou ser reiniciado.');
    } else {
      const subiu = await rodarComando(ETAPA_REINICIAR, {
        exibir: 'docker compose -p ' + PROJETO + ' up -d --no-deps ' + lista.join(' '),
        executar: () =>
          executar('docker', comandoCompose(plano.precisaPerfilGpu, ['up', '-d', '--no-deps', ...lista]), {
            tempoLimite: TEMPO_UP,
            aoLinha: adicionarLog,
          }),
      });
      if (!subiu) return;
    }

    const head = await lerCommit('HEAD');
    if (head) {
      implantado = head.commit;
      const gravou = await gravarArquivo(ARQ_IMPLANTADO, head.commit + '\n');
      if (!gravou) adicionarLog('Aviso: não foi possível gravar o commit implantado.');
    } else {
      adicionarLog('Aviso: não foi possível ler o commit atual depois da atualização.');
    }
    tarefa.estado = 'CONCLUIDA';
    tarefa.etapa = 'Concluída';
    tarefa.terminadaEm = agora();
    await persistirTarefa();
  } catch (erro) {
    registrar('Erro inesperado na atualização: ' + ocultarCredenciais(textoErro(erro)));
    try {
      await falharTarefa(tarefa.etapa || 'Atualização', { erro: textoErro(erro) });
    } catch {
      // nada mais a fazer além do registro
    }
  }
}

function iniciarAtualizacao() {
  // Estado vai para EXECUTANDO antes de qualquer await, para que dois POST não iniciem duas tarefas.
  tarefa = {
    estado: 'EXECUTANDO',
    etapa: 'Iniciando',
    iniciadaEm: agora(),
    terminadaEm: null,
    erro: null,
    log: [],
  };
  persistirTarefa().catch(() => {});
  rodarAtualizacao().catch((erro) => registrar('Falha ao rodar a atualização: ' + textoErro(erro)));
}

// ---------- inicialização ----------

async function iniciar() {
  try {
    const lista = await executar('git', ['config', '--global', '--get-all', 'safe.directory'], {
      tempoLimite: TEMPO_LEITURA,
    });
    const jaConfigurado = lista.saida.split('\n').map((l) => l.trim()).includes(PASTA_PROJETO);
    if (!jaConfigurado) {
      const r = await executar('git', ['config', '--global', '--add', 'safe.directory', PASTA_PROJETO], {
        tempoLimite: TEMPO_LEITURA,
      });
      if (r.codigo !== 0) registrar('Não foi possível configurar safe.directory: ' + resumoFalha(r));
    }
  } catch (erro) {
    registrar('Erro ao configurar o Git: ' + textoErro(erro));
  }

  try {
    const lido = ((await lerArquivo(ARQ_IMPLANTADO)) ?? '').trim();
    if (HASH_COMMIT.test(lido)) {
      implantado = lido;
    } else {
      // Primeira subida: o instalador acabou de construir tudo, então o commit atual é o implantado.
      const head = await lerCommit('HEAD');
      implantado = head ? head.commit : null;
      if (head) await gravarArquivo(ARQ_IMPLANTADO, head.commit + '\n');
    }
  } catch (erro) {
    registrar('Erro ao ler o commit atual: ' + textoErro(erro));
  }

  try {
    const bruto = await lerArquivo(ARQ_TAREFA);
    let salvo = null;
    try {
      salvo = JSON.parse(bruto ?? 'null');
    } catch {
      salvo = null;
    }
    if (salvo && typeof salvo === 'object' && ESTADOS.includes(salvo.estado)) {
      tarefa = {
        estado: salvo.estado,
        etapa: typeof salvo.etapa === 'string' ? salvo.etapa : '',
        iniciadaEm: typeof salvo.iniciadaEm === 'string' ? salvo.iniciadaEm : null,
        terminadaEm: typeof salvo.terminadaEm === 'string' ? salvo.terminadaEm : null,
        erro: typeof salvo.erro === 'string' ? salvo.erro : null,
        log: Array.isArray(salvo.log)
          ? salvo.log.filter((l) => typeof l === 'string').slice(-MAX_LOG).map((l) => cortar(l, MAX_LINHA))
          : [],
      };
      if (tarefa.estado === 'EXECUTANDO') {
        tarefa.estado = 'FALHOU';
        tarefa.erro = 'O atualizador reiniciou durante a atualização';
        tarefa.terminadaEm = agora();
        await persistirTarefa();
      }
    }
  } catch (erro) {
    registrar('Erro ao ler a tarefa anterior: ' + textoErro(erro));
  }

  try {
    await fs.mkdir(PASTA_BACKUPS, { recursive: true });
  } catch (erro) {
    registrar('Não foi possível criar a pasta de backups: ' + textoErro(erro));
  }

  if (!(await segredoEfetivo())) {
    registrar('JWT_SECRET não encontrado: o atualizador responde 401 até o segredo do servidor existir.');
  }
}

// ---------- HTTP ----------

function enviarJson(res, status, corpo, cabecalhos = {}) {
  const texto = JSON.stringify(corpo);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(texto),
    ...cabecalhos,
  });
  res.end(texto);
}

function tokenValido(req, esperado) {
  const recebido = req.headers['x-atualizador-token'];
  if (typeof recebido !== 'string') return false;
  const a = Buffer.from(recebido, 'utf8');
  const b = Buffer.from(esperado, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function tratar(req, res) {
  // O corpo da requisição é ignorado; só drenamos para não deixar a conexão presa.
  req.resume();

  const url = new URL(req.url ?? '/', 'http://atualizador.local');

  // Healthcheck do Compose: sem token.
  if (url.pathname === '/saude') {
    if (req.method !== 'GET') {
      return enviarJson(res, 405, { erro: 'Método não permitido.' }, { Allow: 'GET' });
    }
    return enviarJson(res, 200, { ok: true });
  }

  const esperado = await tokenEsperado();
  if (!esperado || !tokenValido(req, esperado)) {
    return enviarJson(res, 401, { erro: 'Não autorizado.' });
  }

  if (url.pathname === '/estado') {
    if (req.method !== 'GET') {
      return enviarJson(res, 405, { erro: 'Método não permitido.' }, { Allow: 'GET' });
    }
    // A verificação (git fetch) roda em segundo plano: a resposta sai na hora com `verificando: true`
    // e quem consulta repete o GET /estado até `verificando` voltar a false.
    const verificar = url.searchParams.get('verificar') === '1';
    if (verificar && !verificacaoPendente && tarefa.estado !== 'EXECUTANDO') {
      // A marca sobe antes de qualquer espera, para duas chamadas juntas não dispararem dois fetch.
      verificacaoPendente = true;
      try {
        if (!ultimoEstado) await montarEstado(true);
      } catch (erro) {
        verificacaoPendente = false;
        throw erro;
      }
      comGitExclusivo(verificarRemoto)
        .catch((erro) => registrar('Erro na verificação: ' + textoErro(erro)))
        .finally(() => {
          verificacaoPendente = false;
          ultimoEstadoEm = 0; // força a releitura na próxima consulta
        });
    }
    const estado = await montarEstado();
    return enviarJson(res, 200, { ...estado, verificando: verificacaoPendente });
  }

  if (url.pathname === '/atualizar') {
    if (req.method !== 'POST') {
      return enviarJson(res, 405, { erro: 'Método não permitido.' }, { Allow: 'POST' });
    }
    if (tarefa.estado === 'EXECUTANDO') {
      return enviarJson(res, 409, { erro: 'Já existe uma atualização em andamento' });
    }
    iniciarAtualizacao();
    return enviarJson(res, 202, { iniciada: true });
  }

  return enviarJson(res, 404, { erro: 'Não encontrado.' });
}

function criarServidor() {
  const servidor = http.createServer((req, res) => {
    tratar(req, res).catch((erro) => {
      registrar('Erro na requisição: ' + ocultarCredenciais(textoErro(erro)));
      try {
        if (!res.headersSent) {
          enviarJson(res, 500, { erro: 'Erro interno do atualizador.' });
        } else {
          res.end();
        }
      } catch {
        // conexão já fechada
      }
    });
  });
  servidor.on('error', (erro) => {
    registrar('Erro no servidor HTTP: ' + ocultarCredenciais(textoErro(erro)));
  });
  return servidor;
}

// Só sobe o servidor quando o arquivo é executado direto (node /app/servidor.mjs); importar não inicia nada.
function executadoDiretamente() {
  if (!process.argv[1]) return false;
  return path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
}

if (executadoDiretamente()) {
  process.on('uncaughtException', (erro) => {
    registrar('Erro não tratado: ' + ocultarCredenciais(textoErro(erro)));
  });
  process.on('unhandledRejection', (erro) => {
    registrar('Promessa rejeitada: ' + ocultarCredenciais(textoErro(erro)));
  });

  const servidor = criarServidor();
  (async () => {
    try {
      await iniciar();
    } catch (erro) {
      registrar('Erro na inicialização: ' + ocultarCredenciais(textoErro(erro)));
    }
    servidor.listen(PORTA, '0.0.0.0', () => {
      registrar('Atualizador ouvindo na porta ' + PORTA + '.');
      agendarVerificacoes();
    });
  })();
}
