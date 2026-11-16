# Instalador do AI Creator para Windows (PowerShell).
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File .\instalar.ps1
#   ... -Ollama               também sobe o Ollama (modelos locais)
#   ... -SemPerguntas         não pergunta as chaves de API
#
# Códigos de saída:
#   0 instalado | 2 Docker ausente | 3 Docker parado ou sem Compose
#   4 falha ao subir os contêineres | 5 o servidor não ficou saudável a tempo

param(
    [switch]$Ollama,
    [switch]$SemPerguntas
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$arquivoEnv = Join-Path $PSScriptRoot '.env'
$utf8SemBom = New-Object System.Text.UTF8Encoding $false

function Ler-Env([string]$chave) {
    if (-not (Test-Path $arquivoEnv)) { return '' }
    foreach ($linha in [System.IO.File]::ReadAllLines($arquivoEnv)) {
        if ($linha -match "^$chave=(.*)$") { return $Matches[1] }
    }
    return ''
}

function Gravar-Env([string]$chave, [string]$valor) {
    $linhas = [System.Collections.Generic.List[string]]::new()
    $achou = $false
    foreach ($linha in [System.IO.File]::ReadAllLines($arquivoEnv)) {
        if ($linha -match "^$chave=") {
            $linhas.Add("$chave=$valor")
            $achou = $true
        } else {
            $linhas.Add($linha)
        }
    }
    if (-not $achou) { $linhas.Add("$chave=$valor") }
    [System.IO.File]::WriteAllLines($arquivoEnv, $linhas, $utf8SemBom)
}

function Gerar-Segredo {
    $bytes = New-Object byte[] 24
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return ([BitConverter]::ToString($bytes) -replace '-', '').ToLower()
}

Write-Host '== AI Creator: instalação ==' -ForegroundColor Cyan

# 1) Docker
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host 'Docker não encontrado.'
    Write-Host 'Instale o Docker Desktop (https://www.docker.com/products/docker-desktop/), abra-o e rode este instalador de novo.'
    exit 2
}
docker info | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'O Docker está instalado, mas não está rodando. Abra o Docker Desktop, espere iniciar e rode de novo.'
    exit 3
}
docker compose version | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'O Docker Compose não está disponível. Atualize o Docker Desktop e rode de novo.'
    exit 3
}
Write-Host 'Docker OK.' -ForegroundColor Green

# 2) Arquivo .env com segredos aleatórios (só cria se não existir)
if (Test-Path $arquivoEnv) {
    Write-Host 'Arquivo .env já existe; será mantido.'
    # Instalação anterior sem o broker MQTT: gera a senha só se estiver vazia
    if (-not (Ler-Env 'MQTT_SENHA')) { Gravar-Env 'MQTT_SENHA' (Gerar-Segredo) }
    if (-not (Ler-Env 'MQTT_USUARIO')) { Gravar-Env 'MQTT_USUARIO' 'aic' }
} else {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot '.env.example') -Destination $arquivoEnv
    Gravar-Env 'POSTGRES_PASSWORD' (Gerar-Segredo)
    Gravar-Env 'JWT_SECRET' (Gerar-Segredo)
    Gravar-Env 'INTERNO_TOKEN' (Gerar-Segredo)
    Gravar-Env 'MQTT_SENHA' (Gerar-Segredo)
    Write-Host 'Arquivo .env criado com segredos aleatórios.'
}

# 3) Chaves de LLM (opcionais)
if (-not $SemPerguntas) {
    if (-not (Ler-Env 'ANTHROPIC_API_KEY')) {
        $chave = Read-Host 'Chave da API Anthropic (Enter para pular)' -AsSecureString
        $texto = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($chave))
        if ($texto) { Gravar-Env 'ANTHROPIC_API_KEY' $texto }
    }
    if (-not (Ler-Env 'OPENAI_API_KEY')) {
        $chave = Read-Host 'Chave da API OpenAI (Enter para pular)' -AsSecureString
        $texto = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($chave))
        if ($texto) { Gravar-Env 'OPENAI_API_KEY' $texto }
    }
    # IP desta máquina para as placas ESP32 (opcional)
    if (-not (Ler-Env 'MQTT_HOST_PUBLICO')) {
        $ip = (Read-Host 'IP desta máquina na rede para as placas ESP32, ex. 192.168.0.10 (Enter para pular)').Trim()
        if ($ip) {
            if ($ip -notmatch '^[0-9A-Za-z.-]+$') {
                Write-Host 'IP inválido; pulando. Edite MQTT_HOST_PUBLICO no .env depois.' -ForegroundColor Yellow
            } else {
                $portaWebIp = Ler-Env 'WEB_PORT'
                if (-not $portaWebIp) { $portaWebIp = '8080' }
                Gravar-Env 'MQTT_HOST_PUBLICO' $ip
                Gravar-Env 'SERVIDOR_URL_PUBLICA' "http://${ip}:$portaWebIp"
            }
        }
    }
}

# 4) Subir os contêineres
Write-Host 'Baixando e montando os contêineres (na primeira vez pode levar vários minutos)...'
if ($Ollama) {
    docker compose --profile ollama up -d --build
} else {
    docker compose up -d --build
}
if ($LASTEXITCODE -ne 0) {
    docker compose logs --tail 40
    Write-Host 'Falha ao subir os contêineres. Leia as mensagens acima e rode de novo.'
    exit 4
}

# 5) Esperar o servidor ficar saudável
Write-Host 'Aguardando o servidor ficar pronto...'
$idServidor = (docker compose ps -q server)
$saudavel = $false
for ($i = 0; $i -lt 60; $i++) {
    $estado = (docker inspect --format '{{.State.Health.Status}}' $idServidor)
    if ($estado -eq 'healthy') { $saudavel = $true; break }
    Start-Sleep -Seconds 3
}
if (-not $saudavel) {
    Write-Host 'O servidor não ficou pronto a tempo. Veja: docker compose logs --tail 100 server'
    exit 5
}

# 6) Resultado
$portaWeb = Ler-Env 'WEB_PORT'
if (-not $portaWeb) { $portaWeb = '8080' }
$emailAdmin = Ler-Env 'ADMIN_EMAIL'
if (-not $emailAdmin) { $emailAdmin = 'admin@aicreator.local' }
$senhaAdmin = Ler-Env 'ADMIN_SENHA'
if (-not $senhaAdmin) { $senhaAdmin = 'trocar123' }

# Registra no atualizador a versão que acabou de subir (o botão Atualizar da tela compara com ela).
# Sem Git na pasta ou sem o serviço, o comando falha em silêncio e nada muda.
$temGit = Test-Path -LiteralPath (Join-Path $PSScriptRoot '.git')
$anteriorErro = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
docker compose exec -T atualizador sh -c 'git -C /projeto rev-parse HEAD > /dados/implantado.novo && mv /dados/implantado.novo /dados/implantado' *> $null
$ErrorActionPreference = $anteriorErro

Write-Host ''
Write-Host 'AI Creator instalado e no ar.' -ForegroundColor Green
Write-Host "  Endereço:  http://localhost:$portaWeb"
Write-Host "  Login:     $emailAdmin"
Write-Host "  Senha:     $senhaAdmin"
Write-Host 'Troque a senha em Meu perfil no primeiro acesso.'
if (-not $temGit) {
    Write-Host ''
    Write-Host 'Aviso: esta pasta não é um repositório Git (talvez tenha sido baixada como ZIP).'
    Write-Host 'O botão Atualizar da tela não vai funcionar aqui. Para usar a atualização, instale de novo com git clone.'
}
