import { expect, test } from '@playwright/test';

const EMAIL = process.env.E2E_EMAIL ?? 'admin@aicreator.local';
const SENHA = process.env.E2E_SENHA ?? 'senha-e2e-123';

test('cria um agente LLM e ele aparece na lista', async ({ page }) => {
  const nome = `Agente E2E ${Date.now()}`;

  await page.goto('/login');
  await page.getByLabel('E-mail', { exact: true }).fill(EMAIL);
  await page.getByLabel('Senha', { exact: true }).fill(SENHA);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByText(/Olá/).first()).toBeVisible();

  await page.goto('/app/agentes/novo');
  await page.getByLabel('Nome', { exact: true }).fill(nome);
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Alterações salvas.').or(page.getByText(nome)).first()).toBeVisible();

  await page.goto('/app/agentes');
  await expect(page.getByText(nome).first()).toBeVisible();
});
