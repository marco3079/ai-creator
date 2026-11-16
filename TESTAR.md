# O que ainda precisa de teste

Tudo o que dava para testar sem placa nem chave de API já foi testado no Docker (fila, vigia, eventos ao vivo, testar modelo, coleta com simulador, custos, histórico de projetos, frota com telemetria simulada, testes de API e E2E). A lista abaixo é o que **só você** consegue testar, com o que precisa para cada item.

Antes de tudo:

```bash
docker compose up -d --build
```

Abra `http://localhost:8080`, entre com o admin do `.env` e troque a senha quando o sistema pedir.

## 1. Com uma placa ESP32 (USB)

Precisa de: ESP32 (DevKit), cabo USB de dados, Chrome ou Edge (Web Serial).

| # | O que testar | Como | Resultado esperado |
|---|---|---|---|
| 1.1 | Gravar firmware pelo navegador | Projetos → criar projeto ESP32 → Compilar → Gravar | A placa reinicia rodando o firmware |
| 1.2 | Monitor serial | Projetos → Monitor serial, 115200 baud | Ver as mensagens do `Serial.println` ao vivo; enviar texto funciona |
| 1.3 | Coletar dados pela serial | Dados → Coletar pela placa, com o firmware de coleta (`# AIC-COLETA ...`) | Amostras aparecem na tela e viram um dataset |
| 1.4 | Modelo TinyML na placa | Treinar um modelo (ex.: gestos ou tabular) → compilar projeto com o modelo → gravar | A placa imprime a classe prevista; compare com a aba **Testar** |
| 1.5 | Palavra-chave por áudio (KWS) | Precisa também de um microfone I2S (ex.: INMP441). Dataset SONS → treinar → projeto de áudio | A placa detecta a palavra |

## 2. Frota e atualização pelo ar (OTA)

Precisa de: ESP32 na mesma rede Wi-Fi do PC, porta **1883** (MQTT) e a porta web (8080) liberadas no firewall do Windows, e `MQTT_HOST_PUBLICO` / `SERVIDOR_URL_PUBLICA` no `.env` com o IP do PC na rede (o `instalar.ps1` pergunta).

1. Projetos → novo projeto com o modelo **OTA** → compilar.
2. Frota → novo dispositivo vinculado ao projeto → **Gerar chave** → **Baixar aic_config.h**.
3. Preencha Wi-Fi no `aic_config.h`, coloque-o no projeto e grave **por USB** a primeira vez.
4. Esperado: o dispositivo fica **online** em segundos, com RSSI e heap nos gráficos.
5. Edite o código, compile de novo, **Definir versão** → o novo build → **Atualizar agora**.
6. Esperado: a placa baixa, grava e reinicia; o status da OTA vira sucesso e a versão atual muda.
7. Teste também: **Reiniciar**, desligar a placa (vira offline) e uma chave errada (a OTA recusa).

## 3. Com chave da Anthropic (`ANTHROPIC_API_KEY` no `.env`)

| # | O que testar | Resultado esperado |
|---|---|---|
| 3.1 | Playground de um agente Claude | Resposta em streaming |
| 3.2 | Agente com ferramentas da plataforma (ligar "Ferramentas" no agente vinculado a um projeto) | Pedir "leia o main.cpp e compile" → o agente lista/lê arquivos e dispara a compilação |
| 3.3 | Uso e custos | A tela Uso mostra tokens e custo da conversa |

## 4. Com chave da OpenAI (`OPENAI_API_KEY` no `.env`)

Atenção: estes testes **cobram** da sua conta OpenAI.

| # | O que testar | Resultado esperado |
|---|---|---|
| 4.1 | Agente OpenAI no playground e com ferramentas | Igual ao 3.1 / 3.2 |
| 4.2 | Ajuste fino de LLM na OpenAI (Modelos → LLM ajuste fino) | O trabalho sai da fila, termina, e o modelo ajustado fica disponível para os agentes |

## 5. GPU (ajuste LoRA local)

Precisa de: placa NVIDIA com driver recente e Docker Desktop com suporte a GPU (WSL2).

```bash
docker compose --profile gpu --profile ollama up -d --build
```

Modelos → **LLM local (LoRA)** → dataset de conversas → treinar. O resultado do teste já feito aqui na RTX 2060 está no final deste arquivo.

## 6. Extensão do VS Code no Marketplace

Precisa de: conta de publisher no Marketplace e um token (PAT) do Azure DevOps.

1. No GitHub: Settings → Secrets → Actions → criar `VSCE_PAT`.
2. Criar a tag `vscode-v0.2.0` e enviar (`git tag vscode-v0.2.0 && git push origin vscode-v0.2.0`).
3. Esperado: o workflow **Release da extensão VS Code** cria a Release com o `.vsix` e publica no Marketplace.

Sem o `VSCE_PAT` só a Release com o `.vsix` é criada.

## 7. Integração com Claude Code (MCP)

Conecte o servidor MCP (veja `docs/INTEGRACOES.md`) e peça ao Claude Code para listar projetos, editar um arquivo e compilar. Esperado: as mudanças aparecem na plataforma e no **Histórico** do projeto.

## 8. Atualização pelo painel

Precisa de: uma instalação feita com `git clone` (não por ZIP), a conta de administrador e um commit novo no GitHub, feito **depois** da instalação, no mesmo ramo que está instalado.

Passos:

1. No terminal, anote o commit instalado: `git rev-parse --short HEAD`.
2. No GitHub, faça um commit pequeno no ramo instalado. Para o primeiro teste, mude só o `README.md` (assim nenhum serviço precisa ser reconstruído).
3. Entre como administrador e abra **Sistema > Atualização**. Clique em **Verificar agora**.
4. Clique em **Atualizar agora** e acompanhe o log na tela.
5. Depois, faça um segundo commit no GitHub que mexa em `server/` e repita os passos 3 e 4 (agora só o `server` deve ser reconstruído).

| # | O que testar | Resultado esperado |
|---|---|---|
| 8.1 | Aviso no topo da tela | Para o administrador, aparece o aviso de versão nova. Para outro perfil, não aparece |
| 8.2 | Verificar agora | A tela mostra o commit novo, quantos commits estão atrás e a lista de serviços a reconstruir (vazia para mudança só no `README.md`) |
| 8.3 | Atualizar agora | As etapas passam por Copiando o banco, Baixando o código, Reconstruindo e Reiniciando. Ao final o estado fica OK e a versão instalada vira o commit novo |
| 8.4 | Cópia do banco | Existe `backups/aicreator-AAAAMMDD-HHMMSS.sql` com o horário da atualização |
| 8.5 | Só o que mudou | Com a mudança em `server/`, só o `server` é reconstruído; `client`, `trainer` e `builder` não mudam de imagem |
| 8.6 | Pelo terminal | Com nada novo, `.\atualizar.ps1` (ou `sh atualizar.sh` no Linux e macOS) diz que o sistema já estava na última versão |

O teste feito aqui antes do lançamento cobre só a **verificação** (o atualizador responde e compara o commit instalado com o do GitHub). A atualização completa (cópia do banco, `git pull`, reconstrução e reinício) só fica comprovada com um commit novo no GitHub, como descrito acima.

## Resultado do teste de GPU feito aqui

Testado numa **RTX 2060 (6 GB)** com `llama3.2:1b` (`unsloth/Llama-3.2-1B-Instruct`), dataset de 12 conversas, 3 épocas:

- `torch.cuda.is_available()` = `True` dentro do container `finetuner`.
- 3,4 M parâmetros treináveis (0,28 %); 18 passos em ~5 s; perda de 6,0 → 1,04.
- Adaptador gravado (`adapter_model.safetensors`, 13,6 MB) e registrado no Ollama como `aic-assistente-local-lora-v3`; o modelo responde pelo Ollama.
- Tempo total do trabalho ~160 s (a maior parte é baixar o modelo base na primeira vez).
- Com só 12 exemplos o modelo ainda não repete as respostas do dataset; para um resultado útil use centenas de conversas.

Imagem `ai-creator-finetuner`: 9,4 GB (CUDA + PyTorch).
