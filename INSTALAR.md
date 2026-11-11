# Como instalar o AI Creator

Este guia leva você do zero até a plataforma funcionando no seu computador. Não precisa saber programar.

## O que você precisa

- **Docker Desktop**: programa que roda a plataforma em "caixas" separadas. O instalador confere se ele está instalado e aberto. Baixe em https://www.docker.com/products/docker-desktop/.
- **Git**: programa para baixar o projeto. Baixe em https://git-scm.com/downloads. Se não quiser instalar o Git, use o botão "Code" > "Download ZIP" no repositório, descompacte e pule o comando `git clone`.
- Conexão com a internet na primeira instalação, para o Docker baixar as dependências.
- Para usar agentes Claude ou OpenAI: uma chave de API de cada provedor. Sem elas, os agentes Ollama (locais) e a parte de firmware e TinyML continuam funcionando.

## Jeito 1: pedir para um assistente de IA instalar

Se você usa um assistente com acesso ao terminal (Claude Code ou outro), copie o texto abaixo e cole no assistente:

> Instale o AI Creator do repositório https://github.com/marco3079/ai-creator neste computador seguindo o arquivo AGENTS.md do repositório. Ao terminar, me diga o endereço para abrir no navegador e o e-mail e a senha do administrador.

O assistente baixa o projeto, roda o instalador e avisa o endereço do site. A senha inicial do administrador é `trocar123` (e-mail `admin@aicreator.local`); o assistente informa as duas e avisa para trocar a senha no primeiro acesso.

## Jeito 2: com um comando

Abra o terminal (no Windows, o **PowerShell**; no Linux ou macOS, o **Terminal**) e rode os comandos de acordo com o seu sistema.

**Windows (PowerShell):**

```powershell
git clone https://github.com/marco3079/ai-creator.git
cd ai-creator
powershell -ExecutionPolicy Bypass -File .\instalar.ps1
```

**Linux e macOS (Terminal):**

```bash
git clone https://github.com/marco3079/ai-creator.git
cd ai-creator
bash instalar.sh
```

O instalador confere o Docker, cria o arquivo `.env` com segredos aleatórios, pergunta (se você quiser) as chaves de API, baixa tudo e sobe a plataforma. No fim ele mostra:

- o endereço do site (por exemplo, `http://localhost:8080`);
- o e-mail do administrador (`admin@aicreator.local`);
- a senha do administrador (`trocar123`, a senha padrão; troque em "Meu perfil" no primeiro acesso).

Se o instalador parar com uma mensagem, leia a mensagem: ela diz o que fazer. Os códigos de saída estão em `AGENTS.md`.

Para usar modelos locais com Ollama, rode o instalador com `--ollama` (Linux e macOS) ou `-Ollama` (Windows).

## Primeiro acesso

1. Abra o endereço do site no navegador.
2. Entre com o e-mail e a senha mostrados no fim da instalação.
3. Troque a senha em **Meu perfil**, no menu do seu nome.
4. Comece pelo que quiser:
   - crie um agente LLM em **Agentes**, escolha o provedor e teste no playground;
   - crie um agente TinyML, envie um dataset em **Datasets** e treine;
   - crie um projeto em **Projetos** e compile para a placa.

## Usar no celular

1. Conecte o celular na mesma rede Wi-Fi do computador onde a plataforma está rodando.
2. No navegador do celular, abra `http://<IP-do-computador>:8080`. O IP do computador pode ser visto no menu de rede do sistema. Exemplo: `http://192.168.0.10:8080`.
3. Use "Adicionar à tela inicial" para instalar como app.

Só o site fica acessível pela rede. A API e o banco aceitam conexões somente deste computador.

## Atualizar

Entre na pasta do projeto e rode:

```bash
git pull
```

Depois rode o instalador de novo (`.\instalar.ps1` no Windows ou `bash instalar.sh` no Linux e macOS). Os dados são mantidos.

## Parar a plataforma

Na pasta do projeto:

```bash
docker compose down
```

Os dados continuam guardados. Para ligar de novo, rode o instalador outra vez.

## Apagar tudo

Atenção: este comando **apaga o banco de dados e os arquivos** (agentes, datasets, projetos e compilações).

```bash
docker compose down -v
```

## Problemas comuns

**O Docker não está aberto.** O instalador diz "o Docker está instalado, mas não está rodando". Abra o Docker Desktop, espere ele iniciar e rode o instalador de novo.

**Porta ocupada.** Se a porta 8080 já estiver em uso por outro programa, troque `WEB_PORT` no arquivo `.env` (por exemplo, `WEB_PORT=8090`) e rode `docker compose up -d` de novo. O endereço do site muda para a nova porta.

**Esqueci a senha do administrador.** Se você não trocou a senha, ela é `trocar123`. Se você definiu outra em `ADMIN_SENHA` no `.env`, ela está lá. Se já trocou e esqueceu, a saída é apagar o banco (`docker compose down -v`, que apaga todos os dados) e instalar de novo.

**O servidor não ficou pronto a tempo (código 5).** Veja a causa com `docker compose logs --tail 100 server`. Se o erro for de banco, veja `docker compose logs --tail 100 db`. Não apague nada sem antes ler a mensagem.

**A instalação falhou no meio.** Rode o instalador de novo. Ele não sobrescreve o `.env` que já existe.

**Quero usar o Claude ou a OpenAI nos agentes, mas não informei a chave.** Abra o arquivo `.env`, preencha `ANTHROPIC_API_KEY` ou `OPENAI_API_KEY` e rode `docker compose up -d` de novo.

**Gravar a placa pelo servidor não funciona no Windows ou macOS.** A gravação pelo servidor precisa de Linux, com a porta USB mapeada no contêiner. No Windows e no macOS, grave pelo navegador (Web Serial, com Chrome ou Edge) ou pelo VS Code. Veja [docs/FIRMWARE.md](docs/FIRMWARE.md).
