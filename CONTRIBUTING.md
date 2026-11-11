# Como contribuir

Obrigado pelo interesse em melhorar o AI Creator. Este guia explica como relatar problemas, preparar o ambiente, organizar o código e enviar mudanças.

## Relatar um defeito ou sugerir uma melhoria

Use as **issues** do repositório: https://github.com/marco3079/ai-creator/issues

- Para um defeito, use o modelo "Relatar um defeito". Diga o que aconteceu, o que era esperado e como reproduzir.
- Para uma sugestão, use o modelo "Sugerir uma melhoria". Diga qual problema ela resolve.
- Não cole senhas, chaves de API, tokens (`aic_...`) nem o conteúdo do arquivo `.env` em issues, pull requests ou comentários.
- Vulnerabilidades de segurança não devem virar issue pública. Veja [SECURITY.md](SECURITY.md).

## Preparar o ambiente

### Com Docker (recomendado para testar)

Requisitos: Docker com Docker Compose.

- Windows: `.\instalar.ps1`.
- Linux e macOS: `bash instalar.sh`.

O instalador confere o Docker, cria o arquivo `.env` com segredos aleatórios e sobe os contêineres. As instruções completas estão no [README.md](README.md).

### Sem Docker, para desenvolver

Suba só o banco pelo Compose e rode o servidor e o cliente com Node.js 20. O passo a passo está na seção "Desenvolvimento" do [README.md](README.md). O treino (`trainer/`) e a compilação (`builder/`) usam Python 3.11 e podem rodar à parte, como descrito em [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

## Estrutura do código

```
server/                            API (Node 20, Express, Prisma, PostgreSQL)
  prisma/schema.prisma             modelo de dados
  src/lib/                         código compartilhado (erros, autenticação, config)
  src/modules/<modulo>/routes.ts   um arquivo de rotas por módulo
client/                            interface web (React, TypeScript, Vite)
  src/lib/                         código compartilhado (API, autenticação, rotas)
  src/ui/                          componentes visuais e estilo
  src/layout/                      casca do app, painel inicial e login
  src/modules/<modulo>/index.tsx   telas de cada módulo
trainer/                           treino TinyML (Python, FastAPI, TensorFlow)
builder/                           compilação e gravação (Python, FastAPI, PlatformIO)
extensions/vscode/                 extensão do VS Code
integrations/claude-code/          plugin e servidor MCP do Claude Code
```

Cada módulo é uma pasta. O servidor carrega todas as pastas de `server/src/modules/` que têm um `routes.ts`, e o cliente carrega todas as pastas de `client/src/modules/` que têm um `index.tsx` exportando `rotas`. Para criar um módulo novo, basta criar a pasta com o arquivo esperado; não é preciso editar uma lista central.

Para a visão completa, veja [docs/ARQUITETURA.md](docs/ARQUITETURA.md). Para as rotas da API, veja [docs/API.md](docs/API.md).

## Convenções

- TypeScript em modo estrito (`strict: true`).
- Nomes de domínio e rotas da API em português (`/agentes`, `/projetos/:id/build`).
- Não adicione dependência sem necessidade. Antes de instalar um pacote, confirme que a funcionalidade não existe no que já está no projeto.
- Cores só por variáveis de CSS definidas no tema do cliente. Não escreva cor fixa em outros arquivos.
- Erros da API devolvem `{ "erro": "mensagem em português" }`, com o status HTTP adequado.
- Telas precisam funcionar em celular, a partir de 360 px de largura.
- Textos da interface, comentários e mensagens de commit em português.

## Verificação antes do pull request

Rode estes comandos antes de abrir um pull request:

```bash
cd server && npx tsc --noEmit
cd ../client && npx tsc --noEmit && npm run build
docker compose config -q
```

Mudanças na extensão do VS Code e no servidor MCP também devem compilar (`npm run compile` e `npm run build`, respectivamente). O CI em `.github/workflows/ci.yml` roda essas verificações em cada pull request.

## Mensagens de commit

- Curtas, no imperativo e em português. Exemplos: `Adiciona filtro por tipo na lista de agentes`, `Corrige cálculo de frequência no treino`.
- Uma mudança por commit, sempre que possível.

## Fluxo de pull request

1. Crie uma branch a partir de `main`.
2. Faça a mudança e rode a verificação acima.
3. Abra o pull request preenchendo o modelo. Descreva o que mudou, por que e como foi testado.
4. Quando a mudança alterar a tela, inclua prints (antes e depois, se for o caso) e diga se testou no celular.
5. Mantenha a documentação em dia: `docs/API.md` para rotas, `docs/ARQUITETURA.md` para a estrutura e `CHANGELOG.md` para a versão.

Ao contribuir, você concorda em seguir o [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
