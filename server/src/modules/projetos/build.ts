import fs from 'fs';
import path from 'path';
import type { Build } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { config } from '../../lib/config';
import { ErroHttp } from '../../lib/erros';
import { caminhoDados } from '../../lib/arquivos';
import { registrar } from '../../lib/log';
import { emitirEvento } from '../../lib/eventos';
import { ConfigTinyml } from '../agentes/padroes';
import { acordarFila } from '../fila/despachante';
import { enviarPedido, type ResultadoEnvio } from '../fila/servicos';
import { validarCaminho } from './caminhos';

// Compilação de projetos (CONTRATOS-MELHORIAS §1). criarBuild só valida e enfileira; quem envia ao builder é a fila.

export interface OpcoesBuild {
  agenteId?: number;
  modeloTreinoId?: number;
}

// Artefato de um treino da área Modelos (CONTRATOS-MODELOS §1).
interface ArtefatoTreino {
  nome: string;
  tipo: string;
  caminho: string;
  tamanhoBytes: number;
}

// Grava os arquivos do banco em /data/projetos/<slug>, preservando a pasta .pio (cache do PlatformIO).
function escreverProjetoEmDisco(projeto: { slug: string; arquivos: { caminho: string; conteudo: string }[] }): string {
  const pasta = caminhoDados('projetos', projeto.slug);
  fs.mkdirSync(pasta, { recursive: true });
  for (const item of fs.readdirSync(pasta)) {
    if (item === '.pio') {
      continue;
    }
    fs.rmSync(path.join(pasta, item), { recursive: true, force: true });
  }
  for (const arquivo of projeto.arquivos) {
    const relativo = validarCaminho(arquivo.caminho);
    const destino = path.join(pasta, relativo);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, arquivo.conteudo, 'utf8');
  }
  return pasta;
}

// Modelo TinyML do último treino do agente: caminho de origem, ou null se o agente não tem treino com modelo.
async function origemModeloDoAgente(agenteId: number): Promise<string | null> {
  const agente = await prisma.agente.findUnique({ where: { id: agenteId } });
  if (!agente) {
    throw new ErroHttp(404, 'Agente não encontrado');
  }
  const cfgTinyml = (agente.configTinyml as unknown as ConfigTinyml | null) ?? null;
  const ultimoTreinoId = cfgTinyml?.ultimoTreinoId ?? null;
  if (!ultimoTreinoId) {
    return null;
  }
  const treino = await prisma.treino.findUnique({ where: { id: ultimoTreinoId } });
  if (!treino?.modeloH) {
    return null;
  }
  return path.join(config.dataDir, treino.modeloH);
}

// Artefatos HEADER_C de um treino da área Modelos: origem e nome do arquivo em include/.
async function headersDoTreinoModelo(modeloTreinoId: number): Promise<{ origem: string; nome: string }[]> {
  const treino = await prisma.treinoModelo.findUnique({
    where: { id: modeloTreinoId },
    include: { modelo: { select: { tipo: true } } },
  });
  const tipoOk = treino?.modelo.tipo === 'TINYML' || treino?.modelo.tipo === 'TABULAR';
  if (!treino || treino.status !== 'SUCESSO' || !tipoOk) {
    throw new ErroHttp(400, 'Escolha um treino concluído com sucesso de um modelo TinyML ou Tabular');
  }
  const artefatos = (treino.artefatos as unknown as ArtefatoTreino[] | null) ?? [];
  return artefatos
    .filter((a) => a.tipo === 'HEADER_C')
    .map((a) => ({ origem: path.join(config.dataDir, a.caminho), nome: path.basename(a.nome) }));
}

// Valida o pedido e cria o Build em FILA. Não grava arquivos e não chama o builder:
// os arquivos são gravados no envio (prepararArquivosBuild), a partir do banco naquele momento.
export async function criarBuild(
  projetoId: number,
  opcoes: OpcoesBuild,
  usuarioId: number | null,
): Promise<Build> {
  const projeto = await prisma.projeto.findUnique({ where: { id: projetoId } });
  if (!projeto) {
    throw new ErroHttp(404, 'Projeto não encontrado');
  }

  // Validações: o modelo do agente e os headers do treino precisam existir agora.
  if (opcoes.agenteId) {
    const origem = await origemModeloDoAgente(opcoes.agenteId);
    if (origem && !fs.existsSync(origem)) {
      throw new ErroHttp(400, 'O modelo do último treino do agente não foi encontrado');
    }
  }
  if (opcoes.modeloTreinoId) {
    for (const header of await headersDoTreinoModelo(opcoes.modeloTreinoId)) {
      if (!fs.existsSync(header.origem)) {
        throw new ErroHttp(400, `O artefato ${header.nome} do treino não foi encontrado`);
      }
    }
  }

  const build = await prisma.build.create({
    data: {
      projetoId: projeto.id,
      placa: projeto.placa,
      agenteId: opcoes.agenteId ?? null,
      modeloTreinoId: opcoes.modeloTreinoId ?? null,
      status: 'FILA',
    },
  });

  acordarFila();
  emitirEvento({ tipo: 'build', id: build.id, status: 'FILA', projetoId: projeto.id });
  await registrar(usuarioId, 'build.criar', `${projeto.nome} (#${build.id})`);
  return build;
}

// Grava em /data/projetos/<slug> tudo o que ESTE build precisa, logo antes de enviá-lo ao builder:
// os arquivos do projeto do banco, include/model_data.h (último treino do agente), os HEADER_C do treino
// de modelo e include/aic_versao.h com o id deste build. Assim cada build compila exatamente a sua versão,
// mesmo com outros builds do mesmo projeto na fila. Os arquivos enviados são os do banco no momento do envio.
// Só é chamada depois que o despachante reservou o build (FILA -> EXECUTANDO) e nenhum outro build do
// mesmo projeto está EXECUTANDO, então nenhuma outra compilação lê a pasta enquanto ela é regravada.
async function prepararArquivosBuild(build: {
  id: number;
  agenteId: number | null;
  modeloTreinoId: number | null;
  projeto: { slug: string; arquivos: { caminho: string; conteudo: string }[] };
}): Promise<string> {
  const pasta = escreverProjetoEmDisco(build.projeto);

  if (build.agenteId) {
    const origem = await origemModeloDoAgente(build.agenteId);
    if (origem) {
      if (!fs.existsSync(origem)) {
        throw new Error('O modelo do último treino do agente não foi encontrado');
      }
      const destino = path.join(pasta, 'include', 'model_data.h');
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.copyFileSync(origem, destino);
    }
  }

  if (build.modeloTreinoId) {
    for (const header of await headersDoTreinoModelo(build.modeloTreinoId)) {
      if (!fs.existsSync(header.origem)) {
        throw new Error(`O artefato ${header.nome} do treino não foi encontrado`);
      }
      const destino = path.join(pasta, 'include', header.nome);
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.copyFileSync(header.origem, destino);
    }
  }

  const cabecalhoVersao = path.join(pasta, 'include', 'aic_versao.h');
  fs.mkdirSync(path.dirname(cabecalhoVersao), { recursive: true });
  fs.writeFileSync(cabecalhoVersao, `#pragma once\n#define AIC_BUILD_ID ${build.id}\n`, 'utf8');
  return pasta;
}

// Envia o pedido de compilação ao builder. Não muda o status: quem decide é o despachante da fila.
export async function enviarBuild(buildId: number): Promise<ResultadoEnvio> {
  const build = await prisma.build.findUnique({
    where: { id: buildId },
    include: {
      projeto: { select: { slug: true, arquivos: { select: { caminho: true, conteudo: true } } } },
    },
  });
  if (!build) {
    return { erro: 'Compilação não encontrada' };
  }
  try {
    await prepararArquivosBuild(build);
  } catch (erro) {
    return { erro: erro instanceof Error ? erro.message : String(erro) };
  }
  return enviarPedido(
    `${config.builderUrl}/builds`,
    {
      buildId: build.id,
      projetoDir: `/data/projetos/${build.projeto.slug}`,
      placa: build.placa,
      saidaDir: `/data/builds/${build.id}`,
      callbackUrl: `${config.serverUrlInterno}/api/interno/builds/${build.id}`,
      callbackToken: config.internoToken,
    },
    15_000,
  );
}
