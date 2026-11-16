# Leva C: módulo atualizador (atualizar pelo GitHub a partir do painel)

Base: o atualizador do **sistema-escolar**, que já funciona. Leia e reaproveite (sem copiar nomes de serviços `api`/`web`):
- `D:/OneDrive/Documentos/Projetos/GITHUB/GIT/sistema-escolar/docs/plano/w-atualizador.md` (contrato original)
- `D:/OneDrive/Documentos/Projetos/GITHUB/GIT/sistema-escolar/atualizador/{Dockerfile,servidor.mjs}`
- `D:/OneDrive/Documentos/Projetos/GITHUB/GIT/sistema-escolar/server/src/modules/atualizacao/routes.ts`
- `D:/OneDrive/Documentos/Projetos/GITHUB/GIT/sistema-escolar/client/src/modules/configuracoes/Atualizacao.tsx`
- `D:/OneDrive/Documentos/Projetos/GITHUB/GIT/sistema-escolar/instalar.{ps1,sh}` (registro do `implantado`)

Decisões do usuário: reconstrói **só os serviços que mudaram**; **copia o banco** (`pg_dump`) antes; tela em **Sistema → Atualização** (página nova); **aviso no topo** para ADMIN quando houver versão nova; scripts **`atualizar.ps1` / `atualizar.sh`** para atualizar pelo terminal.

## 1. O que muda em relação ao sistema-escolar

| Ponto | sistema-escolar | ai-creator |
|---|---|---|
| Projeto Compose | `PROJETO_COMPOSE` do `.env` | fixo: `ai-creator` (o `docker-compose.yml` tem `name: ai-creator`); variável `PROJETO_COMPOSE` com padrão `ai-creator` |
| Token | `sha256('atualizador:' + JWT_SECRET)` | igual, mas o JWT_SECRET **efetivo**: o servidor usa `config.jwtSegredo` (pode vir de `/data/segredos.json`); o atualizador usa `JWT_SECRET` do ambiente se não for valor de exemplo (`troque-este-segredo`, `troque-este-segredo-de-exemplo`, vazio), senão lê `JWT_SECRET` de `/servidor/segredos.json` (volume `dados` do server montado **somente leitura** em `/servidor`). Sem segredo → todo pedido recebe 401. Releia o arquivo a cada pedido se ainda não tiver o segredo (o server pode criá-lo depois). |
| Serviços | sempre `api web` | **só os que mudaram** (§2) |
| Banco | não toca | `pg_dump` antes de baixar o código (§3) |
| Verificação | ao abrir a tela | também em segundo plano: na subida (após 60 s) e a cada **6 h** |

Tudo o mais segue o original: `git fetch --prune` + `git pull --ff-only` (nunca `reset`, `clean`, `stash`, `checkout` de arquivos), `safe.directory`, tarefa única com log limitado (200 linhas × 500 caracteres), estado em `/dados/tarefa.json`, `implantado` em `/dados/implantado`, tempos limite, `atualizadorMudou` por SHA-256 com CRLF normalizado, nunca recria a si mesmo, nunca apaga volume.

## 2. Quais serviços reconstruir

Arquivos alterados = `git diff --name-only <implantado>..<remoto>` (antes do pull, com o remoto buscado). Mapa por prefixo:

| Prefixo | Serviço | Ação |
|---|---|---|
| `server/` | `server` | build + up |
| `client/` | `client` | build + up |
| `trainer/` | `trainer` | build + up |
| `builder/` | `builder` | build + up |
| `finetuner/` | `finetuner` | build + up **só se o contêiner estiver rodando** |
| `mosquitto/` | `mosquitto` | build + up (imagem própria `mosquitto/Dockerfile` com a configuração copiada; sem bind mount) |
| `docker-compose.yml` | todos os serviços **rodando** (menos `atualizador` e `db`) | up (sem build, o Compose recria o que mudou de configuração) |
| `atualizador/` | — | só `atualizadorMudou: true` (aviso na tela) |
| outros (`docs/`, `README.md`, `extensions/`, `mcp/`, `e2e/`, `exemplos/`…) | — | nada |

Serviços rodando: `docker compose -p ai-creator -f /projeto/docker-compose.yml ps --services --status running`. Perfis opcionais (`finetuner`, `ollama`) só entram se estiverem rodando; para `finetuner` o comando leva `--profile gpu`.
Se `implantado` for desconhecido (nulo ou commit que não existe mais): reconstrói `server client trainer builder` (+ `finetuner` se rodando).
Etapas: `docker compose -p ai-creator -f ARQ_COMPOSE [--profile gpu] build <lista de build>` e depois `up -d --no-deps <lista de build + lista só up>`. Lista vazia → pula a etapa e registra "Nenhum serviço precisou ser reconstruído". No fim grava `implantado` = HEAD.

O estado ganha `servicos: string[]` = a lista prevista para o remoto atual (build + up, sem duplicar, em ordem: server, client, trainer, builder, finetuner, mosquitto e o resto em ordem alfabética). É calculada em toda verificação e mostrada na tela antes de atualizar.

## 3. Cópia do banco

Primeira etapa de `POST /atualizar`, `"Copiando o banco"`:
`docker compose -p ai-creator -f ARQ_COMPOSE exec -T db pg_dump -U aicreator -d aicreator --no-owner` com a saída gravada em `/projeto/backups/aicreator-AAAAMMDD-HHMMSS.sql` (UTC). Escreve num `.parcial` e renomeia no fim. Saída ≠ 0 ou arquivo vazio → FALHOU (apaga o `.parcial`) e para **antes** de baixar o código. Mantém as **5** mais recentes que batem com `/^aicreator-\d{8}-\d{6}\.sql$/` (apaga só essas). A pasta `backups/` vai para o `.gitignore`.
O estado ganha `copias: { nome: string; tamanhoBytes: number; criadoEm: string }[]` (mais recente primeiro).

## 4. Contrato HTTP do atualizador (interno, porta 4000, cabeçalho `X-Atualizador-Token`)

- `GET /estado` / `GET /estado?verificar=1`: igual ao original, mais `servicos` e `copias`.
- `POST /atualizar`: 202 `{ iniciada: true }`, 409 `{ erro }` se já houver tarefa EXECUTANDO, 401 token errado. Etapas: `Copiando o banco` → `Baixando o código` → `Reconstruindo` → `Reiniciando`.
- `GET /saude` sem token → `{ ok: true }` (para o healthcheck).

Tipo do estado (TypeScript, o mesmo do original com os 2 campos novos):
```ts
interface EstadoAtualizacao {
  ramo: string | null; repositorio: string | null;
  instalado: Commit | null; implantado: string | null; remoto: Commit | null;
  atras: number; novidades: { curto: string; mensagem: string; data: string }[];
  precisaReconstruir: boolean; atualizadorMudou: boolean;
  verificadoEm: string | null; erroVerificacao: string | null; verificando?: boolean;
  servicos: string[];
  copias: { nome: string; tamanhoBytes: number; criadoEm: string }[];
  tarefa: { estado: 'PARADA'|'EXECUTANDO'|'CONCLUIDA'|'FALHOU'; etapa: string; iniciadaEm: string|null; terminadaEm: string|null; erro: string|null; log: string[] };
}
interface Commit { commit: string; curto: string; data: string; mensagem: string }
type AtualizacaoDTO = { disponivel: false; motivo: string } | ({ disponivel: true } & EstadoAtualizacao);
```

## 5. API do servidor (`server/src/modules/atualizacao/routes.ts`, `autenticar` + `exigirPerfil('ADMIN')`)

- `GET /atualizacao` (`?verificar=1`) → `AtualizacaoDTO` (zod valida a resposta do atualizador; `limparTexto` tira credenciais de URLs e o endereço interno).
- `POST /atualizacao` → 202 / 409 / 503, como no original; registra no log com `registrar(usuarioId, 'atualizacao.iniciar', ...)` de `lib/log.ts`.
- `GET /atualizacao/resumo` → `{ disponivel: boolean; atras: number; remoto: string | null }` — leve, para o aviso do topo (usa `/estado` sem verificar, cache de 60 s em memória).
- Token: `sha256('atualizador:' + config.jwtSegredo)`; endereço `ATUALIZADOR_URL` (padrão `http://atualizador:4000`).

## 6. Partes

| Parte | Gerador | Arquivos (só estes) |
|---|---|---|
| C01 atualizador | g01 | `atualizador/Dockerfile`, `atualizador/servidor.mjs` (novos) |
| C02 API | g02 | `server/src/modules/atualizacao/routes.ts` (novo), `server/test/atualizacao.test.ts` (novo) |
| C03 tela e aviso | g03 | `client/src/modules/sistema/Atualizacao.tsx`, `client/src/modules/sistema/atualizacao.css` (novos), `client/src/modules/sistema/index.tsx` (só a rota), `client/src/layout/AvisoAtualizacao.tsx` (novo), `client/src/layout/Layout.tsx` (só montar o aviso), `client/src/lib/tipos-atualizacao.ts` (novo) |
| C04 infra, scripts e docs | g04 | `docker-compose.yml`, `.env.example`, `.gitignore`, `instalar.ps1`, `instalar.sh`, `atualizar.ps1`, `atualizar.sh` (novos), `.github/workflows/ci.yml` (job `docker`: `node --check atualizador/servidor.mjs`, `bash -n atualizar.sh`), `README.md`, `docs/ARQUITETURA.md`, `SECURITY.md`, `CHANGELOG.md` (0.4.0), `TESTAR.md` (seção nova "Atualização pelo painel") |


## 7. Ajuste após revisão: sem bind mount relativo
O atualizador roda o Compose de dentro do contêiner (`/projeto`), então um bind relativo (`./x:/y`) viraria `/projeto/x` no daemon do host, que não existe. Regra: **nenhum serviço que o atualizador reconstrói pode ter bind mount**. O mosquitto passa a ter imagem própria (`mosquitto/Dockerfile`: `FROM eclipse-mosquitto:2.0.20`, `COPY mosquitto.conf /mosquitto/config/mosquitto.conf`, `COPY entrypoint.sh /aic/entrypoint.sh`). Proteção no atualizador: antes de Reconstruir, `docker compose config --format json` e, se algum serviço da lista tiver volume `type: bind`, a tarefa FALHA com mensagem clara ("O serviço X usa bind mount; atualize pelo terminal com atualizar.ps1/atualizar.sh").
