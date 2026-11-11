import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { gerarSlug, slugUnico } from '../src/lib/slug';
import { arquivosModelo } from '../src/modules/projetos/modelos';

// Idempotente: pode rodar várias vezes. Admin e plataforma usam upsert; dados de demonstração
// só são criados se ainda não houver nenhum agente.

const CONFIG_TINYML_PADRAO: Prisma.InputJsonObject = {
  tarefa: 'CLASSIFICACAO',
  entrada: { tipo: 'SERIE_TEMPORAL', canais: 3, janela: 50, frequenciaHz: 50 },
  classes: [],
  arquitetura: 'DENSA',
  camadas: 2,
  neuronios: 32,
  epocas: 30,
  taxaAprendizado: 0.001,
  quantizacao: 'INT8',
  placaAlvo: 'ESP32',
  limiteRamKb: 64,
  limiteFlashKb: 256,
  datasetId: null,
  ultimoTreinoId: null,
};

const PROMPT_FIRMWARE = `Você é um assistente especialista em firmware para microcontroladores.
Ajude a escrever, revisar e depurar código em C++ para ESP32 e outras placas Arduino.
Use o PlatformIO como ferramenta de build: o arquivo platformio.ini define o ambiente [env:principal].
Prefira código simples, legível e comentado em português.
Evite delay() longo dentro de laços críticos; prefira millis() quando fizer sentido.
Antes de alterar um arquivo, leia-o e explique a mudança em uma frase.
Ao sugerir pinos, confirme a placa do projeto e cite o número do GPIO.
Sinalize quando um trecho depender de hardware que você não consegue testar.
Se faltar informação (placa, sensor, tensão), pergunte antes de assumir.
Responda de forma objetiva, com blocos de código quando necessário.`;

const PROMPT_REVISOR = `Você revisa código. Aponte bugs, riscos de segurança e pontos de melhoria, em ordem de gravidade.
Explique o motivo de cada apontamento e sugira a correção.
Não reescreva o arquivo inteiro sem necessidade.`;

type DadosAgente = Omit<Prisma.AgenteUncheckedCreateInput, 'slug' | 'autorId' | 'versoes'>;

// Cria o agente com slug único e a VersaoAgente 1 ("Criação").
async function criarAgente(autorId: number, dados: DadosAgente) {
  const slug = await slugUnico(gerarSlug(dados.nome), async (s) => {
    return (await prisma.agente.findUnique({ where: { slug: s } })) !== null;
  });
  const completo: Prisma.AgenteUncheckedCreateInput = { ...dados, slug, autorId };
  const snapshot = JSON.parse(JSON.stringify(completo)) as Prisma.InputJsonValue;
  return prisma.agente.create({
    data: {
      ...completo,
      versoes: { create: { versao: 1, nota: 'Criação', snapshot } },
    },
  });
}

async function main(): Promise<void> {
  const email = (process.env.ADMIN_EMAIL ?? 'admin@aicreator.local').trim().toLowerCase();
  const senha = process.env.ADMIN_SENHA ?? 'trocar123';

  const admin = await prisma.usuario.upsert({
    where: { email },
    update: {},
    create: {
      nome: 'Administrador',
      email,
      senhaHash: await bcrypt.hash(senha, 10),
      perfil: 'ADMIN',
    },
  });

  await prisma.plataforma.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });

  const existentes = await prisma.agente.count();
  if (existentes > 0) {
    console.log('Seed: agentes já existem, dados de demonstração não foram recriados.');
    return;
  }

  const projeto = await prisma.projeto.upsert({
    where: { slug: 'blink-esp32' },
    update: {},
    create: {
      nome: 'Blink ESP32',
      slug: 'blink-esp32',
      descricao: 'Pisca o LED do GPIO 2 e imprime o estado no Serial.',
      placa: 'ESP32',
      framework: 'arduino',
      arquivos: {
        // Mesmo modelo de arquivos de um projeto novo (já inclui model_data.h quando existir).
        create: arquivosModelo('ESP32', 'Blink ESP32'),
      },
    },
  });

  await criarAgente(admin.id, {
    nome: 'Assistente de Firmware',
    descricao: 'Ajuda a escrever e depurar firmware em C++ para ESP32 com PlatformIO.',
    tipo: 'LLM',
    tags: ['firmware', 'esp32'],
    projetoId: projeto.id,
    provedor: 'ANTHROPIC',
    modelo: 'claude-opus-5-5',
    esforco: 'high',
    promptSistema: PROMPT_FIRMWARE,
    ferramentas: ['Read', 'Edit', 'Bash'],
  });

  await criarAgente(admin.id, {
    nome: 'Revisor de Código',
    descricao: 'Revisa alterações de código apontando bugs, riscos e melhorias.',
    tipo: 'LLM',
    tags: ['revisao'],
    provedor: 'ANTHROPIC',
    modelo: 'claude-sonnet-5-5',
    esforco: 'medium',
    promptSistema: PROMPT_REVISOR,
  });

  await criarAgente(admin.id, {
    nome: 'Assistente Local',
    descricao: 'Modelo local via Ollama para perguntas gerais.',
    tipo: 'LLM',
    tags: ['local'],
    provedor: 'OLLAMA',
    modelo: 'llama3.2',
    temperatura: 0.7,
  });

  await criarAgente(admin.id, {
    nome: 'Detector de Gestos',
    descricao: 'Classifica gestos a partir de dados de acelerômetro.',
    tipo: 'TINYML',
    tags: ['tinyml', 'gestos'],
    projetoId: projeto.id,
    configTinyml: { ...CONFIG_TINYML_PADRAO, classes: ['parado', 'acenar', 'circulo'] },
  });

  console.log('Seed: admin, plataforma, projeto Blink ESP32 e 4 agentes de demonstração criados.');
}

main()
  .catch((erro: unknown) => {
    console.error('Falha no seed:', erro);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
