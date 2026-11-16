import { expect, test } from '@playwright/test';

const EMAIL = process.env.E2E_EMAIL ?? 'admin@aicreator.local';
const SENHA = process.env.E2E_SENHA ?? 'senha-e2e-123';

test('usuário criado com senha temporária entra e é levado a trocar a senha', async ({ page, request }) => {
  const emailNovo = `e2e-${Date.now()}@aicreator.local`;
  const senhaTemporaria = 'temp-e2e-12345';

  // O administrador cria o usuário pela API (o servidor marca a troca obrigatória).
  const login = await request.post('/api/auth/login', { data: { email: EMAIL, senha: SENHA } });
  expect(login.status()).toBe(200);
  const { token } = (await login.json()) as { token: string };

  const criado = await request.post('/api/usuarios', {
    headers: { Authorization: `Bearer ${token}` },
    data: { nome: 'Usuário E2E', email: emailNovo, senha: senhaTemporaria, perfil: 'DEV' },
  });
  expect(criado.status()).toBe(201);

  await page.goto('/login');
  await page.getByLabel('E-mail', { exact: true }).fill(emailNovo);
  await page.getByLabel('Senha', { exact: true }).fill(senhaTemporaria);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();

  await expect(page).toHaveURL(/\/trocar-senha/);
  await expect(page.getByRole('heading', { name: 'Crie uma nova senha', exact: true })).toBeVisible();
});
