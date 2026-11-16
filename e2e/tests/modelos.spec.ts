import { expect, test } from '@playwright/test';

const EMAIL = process.env.E2E_EMAIL ?? 'admin@aicreator.local';
const SENHA = process.env.E2E_SENHA ?? 'senha-e2e-123';

test('assistente de novo modelo: escolhe TinyML e avança para tarefa e dados', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(/^E-mail/).fill(EMAIL);
  await page.getByLabel(/^Senha/).fill(SENHA);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByText(/Olá/).first()).toBeVisible();

  await page.goto('/app/modelos/novo');
  const cartaoTinyml = page.getByRole('button', { name: /TinyML \(placa\)/ });
  await cartaoTinyml.click();
  await expect(cartaoTinyml).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Próximo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tarefa e dados', exact: true })).toBeVisible();
});
