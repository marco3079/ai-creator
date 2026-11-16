# Política de segurança

## Versões com suporte

Só a versão mais recente da branch `main` recebe correções de segurança.

| Versão | Suporte |
|---|---|
| 0.4.x | Sim |
| 0.3.x | Não |
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
- falhas na configuração (`docker-compose.yml`, `instalar.sh`, `instalar.ps1`, `atualizar.sh`, `atualizar.ps1`) e no serviço `atualizador/`: segredos fracos, portas expostas sem necessidade, acesso indevido ao Docker.

Não está no escopo: problemas que dependem de a pessoa instalar o sistema com as senhas e os segredos padrão e não trocá-los. O instalador gera segredos aleatórios; use-os.

## Como a plataforma protege os segredos

- **Segredos persistentes**: `JWT_SECRET` e `INTERNO_TOKEN` vêm do `.env`. Se ficarem ausentes ou com o valor de exemplo, o servidor gera um segredo de 32 bytes e grava em `DATA_DIR/segredos.json` (no Docker, `/data/segredos.json`), com permissão 0600. Assim os logins continuam válidos depois de reiniciar. O arquivo fica no volume `dados`: não o compartilhe.
- **Troca de senha obrigatória**: quando a senha do administrador é a padrão (sem `ADMIN_SENHA`), o login pede a troca antes de liberar o sistema. A mesma regra vale para usuários novos e para senhas redefinidas por outro administrador. A nova senha tem no mínimo 8 caracteres e não pode ser igual à atual nem ao e-mail.
- **Chave de cada placa**: a chave de um dispositivo da frota tem o formato `aicd_<40 hex>`. O servidor guarda só o hash SHA-256 e não guarda a chave em claro. Ela aparece uma vez, ao ser gerada. Gerar outra chave invalida a anterior, e a placa precisa do novo `aic_config.h`.
- **MQTT da frota**: o broker não aceita conexões anônimas (`allow_anonymous false`) e exige usuário e senha (`MQTT_USUARIO` e `MQTT_SENHA`). A conexão ainda não usa TLS, então o tráfego na rede local é em texto puro. Em produção, recomendamos TLS, uma credencial por placa (ainda não implementada) e a porta 1883 liberada só para a rede local.
- **Ferramentas do agente**: as ferramentas `aic.*` agem só dentro do projeto vinculado ao agente. Caminhos com `..` ou absolutos são recusados.
- **Atualizador**: o serviço `atualizador` usa o Docker deste computador (o soquete do Docker é montado nele). Por isso não publica porta: só o `server` fala com ele, e só o perfil ADMIN usa a tela ou a API de atualização. O token é derivado do `JWT_SECRET` (`sha256('atualizador:' + JWT_SECRET)`).

## Boas práticas para quem usa a plataforma

- Troque a senha do administrador padrão no primeiro acesso. O sistema pede a troca, mas não escolha uma senha fraca.
- Use valores gerados para `JWT_SECRET` e `INTERNO_TOKEN` (o instalador faz isso sozinho). Se algum ficar com o valor de exemplo, o servidor gera um segredo próprio, como descrito acima.
- Não exponha a porta do banco de dados nem a do servidor à internet. Só o site (`WEB_PORT`) deve ser publicado. A porta do MQTT (1883) fica só na rede local.
- Guarde as chaves de API (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) só no `.env`. Não as coloque em prompts, agentes ou no Git.
- Revogue tokens `aic_` que não usa mais, em **Tokens de API**.
- Trate o `aic_config.h` de uma placa como segredo: ele traz a chave do dispositivo e a senha do MQTT.
- Não envie o arquivo `.env` para o Git nem para outras pessoas.
- Proteja a pasta `backups/`. As cópias do banco (`aicreator-AAAAMMDD-HHMMSS.sql`) contêm os dados da plataforma. Ela já está no `.gitignore`, mas não copie essas cópias para fora do computador sem cuidado.
