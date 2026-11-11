# Instruções para assistentes de IA: AI Creator

Este arquivo serve a dois públicos: assistentes de IA que **instalam** a plataforma para uma pessoa e assistentes de IA que **trabalham no código** do repositório. Leia a seção que corresponde ao seu pedido.

Idioma do projeto: português, em tudo (código, textos de tela, comentários, mensagens de commit).

## Parte 1: instalar para uma pessoa

### O que é

Plataforma web para criar agentes de IA (LLM e TinyML) e compilar firmware, com site (React), API (Node.js), trainer e builder (Python) e banco PostgreSQL, tudo em contêineres Docker.

### Instalar

1. Se o repositório ainda não estiver na máquina, clone e entre na pasta:
   ```
   git clone https://github.com/marco3079/ai-creator.git
   cd ai-creator
   ```
2. Rode o instalador:
   - Windows (PowerShell): `powershell -ExecutionPolicy Bypass -File .\instalar.ps1`
   - Linux e macOS: `bash instalar.sh`
3. O script faz tudo sozinho: confere o Docker, cria o arquivo `.env` com segredos aleatórios, sobe os contêineres com `docker compose up -d --build` e espera o servidor ficar saudável. Na primeira vez pode levar vários minutos.

Opções: `-Ollama` no Windows ou `--ollama` no Linux/macOS sobem também o Ollama. `-SemPerguntas` ou `--sem-perguntas` não pede as chaves de API.

### Códigos de saída do instalador

- **0**: instalado. Vá para "Como confirmar".
- **2**: Docker não está instalado. Oriente a pessoa a instalar o Docker Desktop (https://www.docker.com/products/docker-desktop/), abri-lo e esperar iniciar. Depois rode o instalador de novo.
- **3**: Docker instalado, mas não está rodando (ou falta o Compose). Peça para abrir o Docker Desktop e esperar o ícone ficar estável; depois rode de novo.
- **4**: falha ao subir os contêineres. O script mostra as últimas linhas do log. Leia o erro, corrija o que for possível (espaço em disco, Docker reiniciado) e rode de novo. Se persistir, mostre o erro à pessoa.
- **5**: o servidor não ficou pronto a tempo. Veja `docker compose logs --tail 100 server` e, se o erro for de banco, `docker compose logs --tail 100 db`. Não apague nada para tentar de novo sem perguntar.

### Como confirmar que funcionou

- `docker compose ps` mostra `db`, `server`, `client` e `trainer` e `builder` no ar, com `server` saudável.
- O site abre em `http://localhost:<WEB_PORT>` (variável `WEB_PORT` do `.env`, padrão 8080).

### O que dizer à pessoa no fim

- O endereço do site (`http://localhost:<WEB_PORT>`).
- O e-mail do administrador (`admin@aicreator.local`, ou o valor de `ADMIN_EMAIL` do `.env`).
- A senha do administrador: `trocar123` (ou o valor de `ADMIN_SENHA` do `.env`, se a pessoa tiver definido outra).
- Que ela deve trocar a senha em "Meu perfil" logo no primeiro acesso.

### Regras para o assistente

- Não imprima nem copie o conteúdo do `.env` na resposta, além dos dados de acesso acima.
- Não rode `docker compose down -v` (apaga o banco e os arquivos em `/data`) sem pedido explícito e claro da pessoa.
- Não crie `.env` novo por cima de um banco antigo para "destravar" a instalação.
- Não altere nem pare contêineres que não sejam deste projeto, nem mude portas de outros programas. Se a porta estiver ocupada, troque `WEB_PORT` no `.env` e avise a pessoa.
- Não faça commit do arquivo `.env` nem o inclua em nada que vá para o Git.
- Não instale nada além do Docker (e do Git, se for preciso para clonar) sem a pessoa confirmar.
- Chaves de API (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) só são gravadas no `.env` pelo instalador, com a confirmação da pessoa. Não as mostre na resposta.

### Opções do dia a dia

- **Atualizar**: entre na pasta do projeto, rode `git pull` e depois o instalador de novo. Os dados são mantidos.
- **Parar**: `docker compose down` (os dados ficam guardados).
- **Apagar tudo**: `docker compose down -v`. Só com pedido explícito da pessoa.

## Parte 2: trabalhar no código

### Estrutura

- `server/`: API (Node 20, TypeScript, Express 4, Prisma 5, PostgreSQL). Rotas em `server/src/modules/<modulo>/routes.ts`, bibliotecas comuns em `server/src/lib/`. Schema em `server/prisma/schema.prisma`.
- `client/`: interface (React 18, TypeScript, Vite 5). Módulos em `client/src/modules/<modulo>/index.tsx`, componentes em `client/src/ui/`, casca em `client/src/layout/`.
- `trainer/`: treino TinyML (Python 3.11, FastAPI, TensorFlow CPU).
- `builder/`: compilação e gravação de firmware (Python 3.11, FastAPI, PlatformIO).
- `extensions/vscode/`: extensão do VS Code.
- `integrations/claude-code/`: plugin e servidor MCP do Claude Code.
- `docs/`: documentação técnica. `docs/API.md` lista as rotas; `docs/ARQUITETURA.md` descreve serviços e fluxos.

### Convenções

- TypeScript em modo estrito. Erros da API: `{ "erro": "mensagem em português" }` com o status HTTP adequado.
- Nomes de domínio e rotas em português.
- Cores só pelas variáveis CSS do tema do cliente.
- Não adicione dependência sem necessidade.
- Telas funcionam em celular, a partir de 360 px de largura.
- O `CLAUDE.md` e a pasta `.claude/` são do fluxo de trabalho local; não os altere em um pedido comum de mudança de código.

### Verificação antes de entregar uma mudança

```bash
cd server && npx tsc --noEmit
cd client && npx tsc --noEmit && npm run build
cd extensions/vscode && npm run compile
cd integrations/claude-code/mcp-server && npm run build
cd trainer && pytest tests/test_exportar.py
cd builder && pytest
docker compose config -q
bash -n instalar.sh
```

Se um comando não existir ainda para a parte que você mudou, diga isso na entrega em vez de inventar a verificação.

### Git

- Branch a partir de `main`. Mensagens de commit curtas, no imperativo, em português.
- Não envie segredos, `.env`, dados de `dados/` nem binários grandes que não sejam necessários.
- Pull request: preencha o modelo em `.github/PULL_REQUEST_TEMPLATE.md`.

### Documentação

Quando mudar rota da API, atualize `docs/API.md`. Quando mudar serviço, volume ou fluxo, atualize `docs/ARQUITETURA.md`. Mudanças visíveis entram no `CHANGELOG.md`.
