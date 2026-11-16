import { expect, test } from '@playwright/test';

const EMAIL = process.env.E2E_EMAIL ?? 'admin@aicreator.local';
const SENHA = process.env.E2E_SENHA ?? 'senha-e2e-123';

test('entra com o administrador e vê a saudação', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(/^E-mail/).fill(EMAIL);
  await page.getByLabel(/^Senha/).fill(SENHA);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();

  await expect(page.getByText(/Olá/).first()).toBeVisible();
});
