import { criarApp } from './app';
import { config } from './lib/config';
import { prisma } from './lib/prisma';

async function iniciar(): Promise<void> {
  const app = await criarApp();
  app.listen(config.porta, () => {
    console.log(`AI Creator server na porta ${config.porta}`);
  });
}

iniciar().catch(async (erro: unknown) => {
  console.error('Falha ao iniciar o server:', erro);
  await prisma.$disconnect();
  process.exit(1);
});
