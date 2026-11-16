# Atualiza o AI Creator para o último commit do repositório no GitHub (Windows).
#
#   powershell -ExecutionPolicy Bypass -File .\atualizar.ps1
#
# Faz, nesta ordem: cópia do banco em backups\aicreator-AAAAMMDD-HHMMSS.sql (ficam as 5 mais recentes),
# git pull --ff-only, docker compose up -d --build (o Compose reconstrói só o que mudou) e registra a
# versão no atualizador, que é quem mostra a tela Sistema > Atualização.
#
# Códigos de saída: 0 atualizado (ou já estava na última versão) | 1 não foi possível atualizar

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$PastaBackups = Join-Path $PSScriptRoot 'backups'
$utf8SemBom = New-Object System.Text.UTF8Encoding $false

# Roda um programa externo e devolve a saída (texto) e o código de saída, sem que o stderr pare o script.
function Rodar([string]$programa, [string[]]$argumentos) {
    $anterior = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $saida = & $programa @argumentos 2>&1 | ForEach-Object { "$_" }
        $codigo = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $anterior
    }
    return [pscustomobject]@{ Saida = ($saida -join "`n"); Codigo = $codigo }
}

# Roda um comando git; falha vira exceção com a saída junto.
function Git([string[]]$argumentos) {
    $r = Rodar 'git' $argumentos
    if ($r.Codigo -ne 0) {
        throw "git $($argumentos -join ' ') falhou: $($r.Saida)"
    }
    return $r.Saida.Trim()
}

# Copia do banco: pg_dump escreve no stdout e o texto é gravado em UTF-8 sem BOM (o > do PowerShell gravaria UTF-16).
# Se o pg_dump falhar ou vier vazio, para antes de baixar o código e não deixa arquivo pela metade.
function Copiar-Banco {
    New-Item -ItemType Directory -Force -Path $PastaBackups | Out-Null
    $nome = 'aicreator-' + (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss') + '.sql'
    $destino = Join-Path $PastaBackups $nome
    $parcial = "$destino.parcial"

    $anterior = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $linhas = & docker compose exec -T db pg_dump -U aicreator -d aicreator --no-owner
        $codigo = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $anterior
    }
    if ($codigo -ne 0) { throw 'A cópia do banco falhou (o pg_dump saiu com erro). Nada foi atualizado.' }
    $texto = ($linhas | ForEach-Object { "$_" }) -join "`n"
    if ([string]::IsNullOrWhiteSpace($texto)) { throw 'A cópia do banco veio vazia. Nada foi atualizado.' }

    try {
        [System.IO.File]::WriteAllText($parcial, $texto + "`n", $utf8SemBom)
        Move-Item -LiteralPath $parcial -Destination $destino -Force
    } catch {
        Remove-Item -LiteralPath $parcial -Force -ErrorAction SilentlyContinue
        throw
    }

    # Ficam só as 5 cópias mais recentes (o nome tem data e hora, então a ordem alfabética é a cronológica).
    Get-ChildItem -LiteralPath $PastaBackups -File |
        Where-Object { $_.Name -cmatch '\Aaicreator-\d{8}-\d{6}\.sql\z' } |
        Sort-Object Name -Descending |
        Select-Object -Skip 5 |
        Remove-Item -Force
    return $nome
}

# Grava no atualizador o commit que está no ar. Falha aqui não desfaz a atualização; só avisa.
function Registrar-Implantado {
    $r = Rodar 'docker' @('compose', 'exec', '-T', 'atualizador', 'sh', '-c', 'git -C /projeto rev-parse HEAD > /dados/implantado.novo && mv /dados/implantado.novo /dados/implantado')
    return ($r.Codigo -eq 0)
}

try {
    Git @('rev-parse', '--is-inside-work-tree') | Out-Null
} catch {
    Write-Host 'Esta pasta não é um repositório Git. Para atualizar, instale de novo com git clone.'
    exit 1
}

try {
    Write-Host 'Copiando o banco de dados...'
    $copia = Copiar-Banco
    Write-Host "Cópia do banco: backups\$copia"

    $ramo = Git @('rev-parse', '--abbrev-ref', 'HEAD')
    $antes = Git @('rev-parse', 'HEAD')
    Write-Host "Baixando a versão nova do GitHub (ramo $ramo)..."
    # --ff-only: só avança. Se houver alteração local que conflite, para sem apagar nada.
    Git @('pull', '--ff-only', 'origin', $ramo) | Out-Null
    $depois = Git @('rev-parse', 'HEAD')

    # Perfis opcionais entram só se estiverem rodando (o ps precisa dos dois perfis para mostrá-los).
    $perfis = @()
    $rodando = (Rodar 'docker' @('compose', '--profile', 'gpu', '--profile', 'ollama', 'ps', '--services', '--status', 'running')).Saida -split "`n" | ForEach-Object { $_.Trim() }
    if ($rodando -contains 'finetuner') { $perfis += @('--profile', 'gpu') }
    if ($rodando -contains 'ollama') { $perfis += @('--profile', 'ollama') }

    Write-Host 'Reconstruindo o sistema (pode levar alguns minutos)...'
    $build = Rodar 'docker' (@('compose') + $perfis + @('up', '-d', '--build'))
    if ($build.Codigo -ne 0) {
        $fim = ($build.Saida -split "`n" | Select-Object -Last 6) -join ' | '
        throw "Falha ao reconstruir o sistema: $fim"
    }

    if (-not (Registrar-Implantado)) {
        Write-Host 'Aviso: não consegui registrar a versão no atualizador. A tela pode mostrar a versão como desconhecida.'
    }

    if ($antes -eq $depois) {
        Write-Host "O sistema já estava na última versão. Cópia do banco: backups\$copia"
    } else {
        Write-Host "Atualizado de $($antes.Substring(0, 7)) para $($depois.Substring(0, 7)). Cópia do banco: backups\$copia"
    }
    exit 0
} catch {
    $mensagem = "$($_.Exception.Message)"
    Write-Host "Não foi possível atualizar: $mensagem"
    exit 1
}
