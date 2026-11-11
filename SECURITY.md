# Política de segurança

## Versões com suporte

Só a versão mais recente da branch `main` recebe correções de segurança.

| Versão | Suporte |
|---|---|
| 0.1.x | Sim |
| Anteriores | Não |

## Como relatar uma vulnerabilidade

**Não abra issue pública para vulnerabilidades.** Use o relato privado do GitHub:

1. Acesse https://github.com/marco3079/ai-creator/security.
2. Clique em **Report a vulnerability**.
3. Descreva o problema, como reproduzi-lo, o impacto que você imagina e, se tiver, uma sugestão de correção.

Se não puder usar o GitHub, entre em contato com o responsável pelo projeto por um canal privado.

## O que esperar

- Confirmação do recebimento em até 7 dias.
- Avaliação inicial e retorno sobre a gravidade em até 14 dias.
- Correção e publicação de versão corrigida o quanto antes, com crédito a quem relatou, se a pessoa quiser.

## Escopo

Está no escopo:

- falhas na API (`server/`): autenticação, autorização por perfil, injeção, exposição de dados, tokens `aic_`;
- falhas no cliente web (`client/`): XSS, CSRF, vazamento de token;
- falhas nos serviços de treino e compilação (`trainer/`, `builder/`): execução de código ou escrita fora de `/data`;
- falhas na configuração (`docker-compose.yml`, `instalar.sh`, `instalar.ps1`): segredos fracos, portas expostas sem necessidade.

Não está no escopo: problemas que dependem de a pessoa instalar o sistema com as senhas e os segredos padrão e não trocá-los. O instalador gera segredos aleatórios; use-os.

## Boas práticas para quem usa a plataforma

- Troque a senha do administrador `trocar123` no primeiro acesso.
- Gere um segredo novo para `JWT_SECRET` e `INTERNO_TOKEN` (o instalador faz isso sozinho).
- Não exponha a porta do banco de dados nem a do servidor à internet. Só o site (`WEB_PORT`) deve ser publicado.
- Guarde as chaves de API (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) só no `.env`. Não as coloque em prompts, agentes ou no Git.
- Revogue tokens `aic_` que não usa mais, em **Tokens de API**.
- Não envie o arquivo `.env` para o Git nem para outras pessoas.
