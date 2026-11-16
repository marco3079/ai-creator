import { expect, test } from '@playwright/test';

const EMAIL = process.env.E2E_EMAIL ?? 'admin@aicreator.local';
const SENHA = process.env.E2E_SENHA ?? 'senha-e2e-123';

test('cria um projeto de firmware e abre o editor com main.cpp', async ({ page }) => {
  const nome = `Projeto E2E ${Date.now()}`;

  await page.goto('/login');
  await page.getByLabel(/^E-mail/).fill(EMAIL);
  await page.getByLabel(/^Senha/).fill(SENHA);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByText(/Olá/).first()).toBeVisible();

  await page.goto('/app/projetos');
  await page.getByRole('button', { name: 'Novo projeto', exact: true }).click();
  await page.getByLabel(/^Nome/).fill(nome);
  await page.getByRole('button', { name: 'Criar projeto', exact: true }).click();

  await expect(page).toHaveURL(/\/app\/projetos\/\d+/);
  await expect(page.getByText('main.cpp').first()).toBeVisible();
});
