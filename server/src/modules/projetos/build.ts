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

// Compilação de projetos (CONTRATOS-MELHORIAS §1). criarBuild só enfileira; quem envia ao builder é a fila.

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

// Valida, grava os arquivos do projeto em disco e cria o Build em FILA. Não chama o builder.
export async function criarBuild(
  projetoId: number,
  opcoes: OpcoesBuild,
  usuarioId: number | null,
): Promise<Build> {
  const projeto = await prisma.projeto.findUnique({
    where: { id: projetoId },
    include: { arquivos: { select: { caminho: true, conteudo: true } } },
  });
  if (!projeto) {
    throw new ErroHttp(404, 'Projeto não encontrado');
  }

  // Modelo TinyML do último treino do agente, se informado.
  let origemModelo: string | null = null;
  if (opcoes.agenteId) {
    const agente = await prisma.agente.findUnique({ where: { id: opcoes.agenteId } });
    if (!agente) {
      throw new ErroHttp(404, 'Agente não encontrado');
    }
    const cfgTinyml = (agente.configTinyml as unknown as ConfigTinyml | null) ?? null;
    const ultimoTreinoId = cfgTinyml?.ultimoTreinoId ?? null;
    if (ultimoTreinoId) {
      const treino = await prisma.treino.findUnique({ where: { id: ultimoTreinoId } });
      if (treino?.modeloH) {
        origemModelo = path.join(config.dataDir, treino.modeloH);
        if (!fs.existsSync(origemModelo)) {
          throw new ErroHttp(400, 'O modelo do último treino do agente não foi encontrado');
        }
      }
    }
  }

  // Treino da área Modelos: seus artefatos HEADER_C vão para include/. Valida antes de gravar nada.
  const headersTreino: { origem: string; nome: string }[] = [];
  if (opcoes.modeloTreinoId) {
    const treino = await prisma.treinoModelo.findUnique({
      where: { id: opcoes.modeloTreinoId },
      include: { modelo: { select: { tipo: true } } },
    });
    const tipoOk = treino?.modelo.tipo === 'TINYML' || treino?.modelo.tipo === 'TABULAR';
    if (!treino || treino.status !== 'SUCESSO' || !tipoOk) {
      throw new ErroHttp(400, 'Escolha um treino concluído com sucesso de um modelo TinyML ou Tabular');
    }
    const artefatos = (treino.artefatos as unknown as ArtefatoTreino[] | null) ?? [];
    for (const artefato of artefatos.filter((a) => a.tipo === 'HEADER_C')) {
      const origem = path.join(config.dataDir, artefato.caminho);
      if (!fs.existsSync(origem)) {
        throw new ErroHttp(400, `O artefato ${artefato.nome} do treino não foi encontrado`);
      }
      headersTreino.push({ origem, nome: path.basename(artefato.nome) });
    }
  }

  // Grava os arquivos antes de criar o Build, para não deixar registro órfão se a gravação falhar.
  const pasta = escreverProjetoEmDisco(projeto);
  if (origemModelo) {
    const destinoModelo = path.join(pasta, 'include', 'model_data.h');
    fs.mkdirSync(path.dirname(destinoModelo), { recursive: true });
    fs.copyFileSync(origemModelo, destinoModelo);
  }
  for (const header of headersTreino) {
    const destino = path.join(pasta, 'include', header.nome);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.copyFileSync(header.origem, destino);
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

// Envia o pedido de compilação ao builder. Não muda o status: quem decide é o despachante da fila.
export async function enviarBuild(buildId: number): Promise<ResultadoEnvio> {
  const build = await prisma.build.findUnique({
    where: { id: buildId },
    include: { projeto: { select: { slug: true } } },
  });
  if (!build) {
    return { erro: 'Compilação não encontrada' };
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
