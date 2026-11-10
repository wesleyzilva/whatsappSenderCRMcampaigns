# Disparador WhatsApp - Menu principal (Dra. Daiana Ferraz)
# Uso: duplo clique em iniciar.bat  ou  .\iniciar.ps1
# Estrutura: menu principal -> 5 areas (cada area mostra o que voce pode verificar nela).

$Host.UI.RawUI.WindowTitle = "Disparador WhatsApp - Dra. Daiana Ferraz"
$DIR = $PSScriptRoot
$SRC = Join-Path $DIR "src"

# ---------------------------------------------------------------------------
# Atalhos para os programas
# ---------------------------------------------------------------------------
function Sender { node "$SRC\sender.js" @args }
function Gestao { node "$SRC\gestao.js" @args }
function Voltar { Write-Host ""; Read-Host "  Enter para voltar" | Out-Null }

function Show-Banner {
    Clear-Host
    Write-Host ""
    Write-Host "  ==========================================" -ForegroundColor Yellow
    Write-Host "    DISPARADOR WHATSAPP - Dra. Daiana Ferraz" -ForegroundColor Yellow
    Write-Host "  ==========================================" -ForegroundColor Yellow
    Write-Host ""
}

function Show-Titulo($texto, $cor = "Cyan") {
    Show-Banner
    Write-Host "  >> $texto" -ForegroundColor $cor
    Write-Host ""
}

# ---------------------------------------------------------------------------
# Campanhas (lista de CSVs ja analisados pelo gestao.js)
# ---------------------------------------------------------------------------
function Get-Campanhas {
    param([int]$Limite = 0)
    $arg = if ($Limite -gt 0) { "--csvs=$Limite" } else { "--csvs" }
    try {
        $json = (& node "$SRC\gestao.js" $arg 2>$null | Out-String).Trim()
        if ([string]::IsNullOrWhiteSpace($json)) { return @() }
        return @(ConvertFrom-Json -InputObject $json)
    } catch { return @() }
}

function Get-CampanhaRotulo {
    param($c)
    switch ($c.status) {
        "concluida"               { return @("CONCLUIDA 100%", "Green") }
        "concluida_com_ressalvas" { return @("CONCLUIDA COM RESSALVAS ($($c.falhas) falhas)", "Yellow") }
        "em_andamento"            { return @("EM ANDAMENTO $($c.pctProcessado)%", "Cyan") }
        "nao_iniciada"            { return @("nao iniciada", "DarkGray") }
        "aguardando_mes"          { return @("AGUARDA VIRADA DO MES", "Yellow") }
        default                   { return @("vazia", "DarkRed") }
    }
}

function Show-Situacao {
    Write-Host "  Data atual : $(Get-Date -Format 'dd/MM/yyyy  HH:mm')" -ForegroundColor Gray
    $zapsLinha = & node "$SRC\sender.js" --zaps-resumo 2>$null
    if ($zapsLinha) { Write-Host "  $zapsLinha" -ForegroundColor Gray }
    $camp = @(Get-Campanhas 1)
    if ($camp.Count -eq 0) {
        Write-Host "  Campanha   : [!!] Nenhuma lista encontrada - va em [2] Campanha > gerar lista" -ForegroundColor Red
    } else {
        $c = $camp[0]
        $rot = Get-CampanhaRotulo $c
        $marca = if ($c.status -in @("concluida", "concluida_com_ressalvas", "aguardando_mes")) { "[!!]" } else { "[OK]" }
        Write-Host "  Campanha   : $marca $($c.arquivo) - $($rot[0])  (enviados $($c.enviados) | sem WhatsApp $($c.semWhatsapp) | falhas $($c.falhas) | pendentes $($c.pendentes))" -ForegroundColor $rot[1]
        if ($c.status -eq "concluida") {
            Write-Host "               PROXIMO PASSO: campanha terminou. Gere a proxima em [2] Campanha > Gerar lista." -ForegroundColor Green
        } elseif ($c.status -eq "concluida_com_ressalvas") {
            Write-Host "               Veja o fechamento e decida: retentar falhas ou gerar nova lista (menu [2])." -ForegroundColor DarkGray
        }
    }
    Write-Host ""
}

# ---------------------------------------------------------------------------
# Selecao de lista / campanha / DDD / zaps
# ---------------------------------------------------------------------------
function Select-CSV {
    $total = @(Get-ChildItem -Path "$DIR\dados\listas" -Filter "*.csv" -ErrorAction SilentlyContinue).Count
    if ($total -eq 0) { Write-Host "  Nenhuma lista em dados\listas." -ForegroundColor Red; return $null }
    $todas = $false
    while ($true) {
        $lista = @(Get-Campanhas $(if ($todas) { 0 } else { 3 }))
        if ($lista.Count -eq 0) { Write-Host "  Nao consegui ler as listas (verifique o Node.js)." -ForegroundColor Red; return $null }
        Write-Host ("  " + $(if ($todas) { "Todas as listas (mais recentes primeiro):" } else { "As 3 listas mais recentes (as demais: opcao T):" })) -ForegroundColor Cyan
        $i = 1
        foreach ($c in $lista) {
            $rot = Get-CampanhaRotulo $c
            Write-Host "  [$i] $($c.arquivo)   <$($rot[0])>" -ForegroundColor $rot[1]
            Write-Host "      campanha: $($c.campanha)  |  segmento: $($c.segmento)  |  $($c.unicos) contatos | enviados $($c.enviados) | sem WhatsApp $($c.semWhatsapp) | falhas $($c.falhas) | pendentes $($c.pendentes)" -ForegroundColor DarkGray
            $i++
        }
        if (-not $todas -and $total -gt $lista.Count) { Write-Host "  [T] Ver todas as listas ($total)" -ForegroundColor Yellow }
        Write-Host ""
        $sel = Read-Host "  Numero da lista (Enter = [1] mais recente)"
        if ($sel -ieq "t" -and -not $todas) { $todas = $true; Write-Host ""; continue }
        if ([string]::IsNullOrWhiteSpace($sel)) { $sel = "1" }
        if ($sel -match "^\d+$" -and [int]$sel -ge 1 -and [int]$sel -le $lista.Count) {
            return (Join-Path "$DIR\dados\listas" $lista[[int]$sel - 1].arquivo)
        }
        Write-Host "  Opcao invalida." -ForegroundColor Red
        return $null
    }
}

function Select-Campanha {
    $csvFiles = Get-ChildItem -Path "$DIR\dados\listas" -Filter "*.csv" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
    $campanhas = @()
    foreach ($f in $csvFiles) {
        if ($f.Name -match '^lista_(.+)_([A-Z]{1,5})_(\d{8})\.csv$') {
            if ($campanhas -notcontains $Matches[1]) { $campanhas += $Matches[1] }
        }
    }
    Write-Host ""
    if ($campanhas.Count -gt 0) {
        Write-Host "  Campanhas ja existentes:" -ForegroundColor Cyan
        $i = 1
        foreach ($c in $campanhas) { Write-Host "  [$i] $c" -ForegroundColor Cyan; $i++ }
        Write-Host "  [N] Criar nova campanha" -ForegroundColor Yellow
        Write-Host ""
        $sel = Read-Host "  Selecione (numero ou N)"
        if ($sel -match "^\d+$" -and [int]$sel -ge 1 -and [int]$sel -le $campanhas.Count) { return $campanhas[[int]$sel - 1] }
    }
    $ano = (Get-Date).Year
    Write-Host ""
    Write-Host "  Formato: ANO_campanha_nome   Exemplo: ${ano}_campanha_aquecimento_whatsapp" -ForegroundColor DarkGray
    $nova = Read-Host "  Nome da campanha (Enter = ${ano}_campanha_aquecimento_whatsapp)"
    if ([string]::IsNullOrWhiteSpace($nova)) { $nova = "${ano}_campanha_aquecimento_whatsapp" }
    return ($nova.Trim().ToLower() -replace '\s+', '_')
}

function Get-DefaultDdd([string]$CsvPath) {
    if ([System.IO.Path]::GetFileName($CsvPath) -match '^lista_patoBranco_PB_\d{8}\.csv$') { return "46" }
    return "16"
}

function Read-DDD([string]$Default = "16") {
    $r = Read-Host "  DDD (Enter = $Default, ou 'todos' para nao filtrar)"
    if ([string]::IsNullOrWhiteSpace($r)) { return $Default }
    if ($r -ieq "todos") { return "" }
    return $r.Trim()
}

function Get-DddArg([string]$Ddd) { if ([string]::IsNullOrWhiteSpace($Ddd)) { return @() } else { return @("--ddd=$Ddd") } }

function Read-EnvioArgs {
    Write-Host ""
    $modo  = Read-Host "  Modo: [S]equencial (um zap por vez) ou [P]aralelo (todos juntos)? (Enter = padrao)"
    $chips = Read-Host "  Quais zaps usar? ex: 1,3  (Enter = todos os conectados)"
    $out = @()
    if ($modo -imatch '^p')     { $out += "--modo=paralelo" }
    elseif ($modo -imatch '^s') { $out += "--modo=sequencial" }
    if (-not [string]::IsNullOrWhiteSpace($chips)) { $out += "--chips=$($chips -replace '\s','')" }
    return $out
}

# ---------------------------------------------------------------------------
# Acoes (cada uma = 1 funcao; os submenus so chamam estas)
# ---------------------------------------------------------------------------
function Acao-Hoje        { Gestao --hoje }
function Acao-Status      { Sender --status }
function Acao-Zaps        { Sender --zaps }
function Acao-Conectar    { Sender --conectar }
function Acao-Testar {
    $sel = Read-Host "  Zap para testar (numero, ex: 1; Enter = todos)"
    if ([string]::IsNullOrWhiteSpace($sel)) { Sender --testar } else { Sender "--testar=$($sel.Trim())" }
}
function Acao-Desconectar { Sender --desconectar }
function Acao-Erros       { Sender --erros }

function Acao-Painel {
    Write-Host "  Painel em http://localhost:3737  (Ctrl+C para fechar)" -ForegroundColor Green
    node "$SRC\painel.js"
}

function Acao-Continuo {
    Write-Host "  MODO CONTINUO: envia ate o teto de cada zap, espera as 24h e ENCERRA sozinho" -ForegroundColor Green
    Write-Host "  quando a campanha terminar (mostrando o fechamento). Parar antes: digite P + Enter." -ForegroundColor Green
    Write-Host ""
    $csvC = $null
    $usaRecente = Read-Host "  Usar a lista mais recente? (S/n)"
    if ($usaRecente -imatch '^n') { $csvC = Select-CSV; if (-not $csvC) { return } }
    $arqRef = if ($csvC) { $csvC } else { $r = @(Get-Campanhas 1); if ($r.Count -gt 0) { $r[0].arquivo } else { "" } }
    $ddd = Read-DDD $(if ($arqRef) { Get-DefaultDdd $arqRef } else { "16" })
    $argsC = @()
    if ($csvC) { $argsC += "$csvC" }
    $argsC += @(Get-DddArg $ddd)
    $argsC += @(Read-EnvioArgs)
    & "$SRC\continuo.ps1" @argsC
}

function Acao-Enviar([string]$Tipo) {
    # Tipo: enviar | simular | limite
    $csv = Select-CSV
    if (-not $csv) { return }
    Write-Host ""
    $ddd = Read-DDD (Get-DefaultDdd $csv)
    $extra = @(Read-EnvioArgs)
    $nodeArgs = @("$csv") + @(Get-DddArg $ddd) + $extra
    if ($Tipo -eq "simular") { $nodeArgs += "--dry-run" }
    if ($Tipo -eq "limite") {
        $lim = Read-Host "  Quantos envios nesta execucao?"
        if ($lim -notmatch "^\d+$") { Write-Host "  Numero invalido." -ForegroundColor Red; return }
        $nodeArgs += "--limit=$lim"
    }
    Write-Host ""
    Sender @nodeArgs
}

function Acao-GerarLista {
    $id = Select-Campanha
    Write-Host "`n  Campanha: $id" -ForegroundColor Cyan
    $seg = Read-Host "  Segmento: letra inicial do nome (A, B, C...) ou TODAS (Enter = A)"
    if ([string]::IsNullOrWhiteSpace($seg)) { $seg = "A" }
    $dbg = Read-Host "  Ativar debug? (s/N)"
    Write-Host "`n  Gerando lista..." -ForegroundColor Magenta
    $pyArgs = @("$SRC\gerar_lista.py", "--id-campanha=$id", "--campanha=$($seg.ToUpper())")
    if ($dbg -ieq "s") { $pyArgs += "--debug" }
    python @pyArgs
    if ($LASTEXITCODE -ne 0) { Write-Host "`n  ERRO ao gerar lista. Verifique o Python e os arquivos em dados\entrada." -ForegroundColor Red }
    else { Write-Host "`n  Lista gerada em dados\listas. Proximo passo: simular [Enviar > Simular] e depois iniciar o modo continuo." -ForegroundColor Green }
}

function Acao-Fechamento   { $c = Select-CSV; Write-Host ""; if ($c) { Gestao --fechamento "$c" } }
function Acao-Retentar     { $c = Select-CSV; Write-Host ""; if ($c) { Gestao --retentar-falhas "$c" } }
function Acao-Relatorio    { $c = Select-CSV; Write-Host ""; if ($c) { Sender "$c" --resumo } else { Sender --resumo } }
function Acao-CustomerMatch {
    Write-Host "  Gerando listas para Customer Match (Google Ads)..." -ForegroundColor Magenta
    python "$SRC\customer_match.py"
    if ($LASTEXITCODE -ne 0) { Write-Host "  ERRO ao gerar Customer Match." -ForegroundColor Red }
    else { Write-Host "  Listas geradas em dados\publico." -ForegroundColor Green }
}
function Acao-ConviteGrupo {
    Write-Host "  Convite para o grupo de promocoes (modelo: dados\entrada\mensagem_grupo_harmonizacao.txt)." -ForegroundColor Cyan
    Write-Host "  No WhatsApp: abra o grupo > Convidar via link > Copiar link." -ForegroundColor DarkGray
    $link = Read-Host "  Cole o link do grupo (https://chat.whatsapp.com/...)"
    if ([string]::IsNullOrWhiteSpace($link)) { return }
    $d = Read-Host "  DDD dos contatos (Enter = 46)"
    if ($d -notmatch "^\d{2}$") { $d = "46" }
    Gestao --convite-grupo "--link=$($link.Trim())" "--ddd=$d"
}
function Acao-Gestao {
    $dias = Read-Host "  Quantos dias analisar? (Enter = 14)"
    if ($dias -notmatch "^\d+$") { $dias = "14" }
    Gestao --gestao "--dias=$dias"
}
function Acao-AtualizarLib {
    Push-Location $DIR
    Write-Host "  Versao instalada:" -ForegroundColor Cyan
    npm ls whatsapp-web.js --depth=0
    Write-Host "  (Feche as outras janelas do disparador antes de atualizar.)" -ForegroundColor Yellow
    if ((Read-Host "  Atualizar para a ultima versao agora? (s/N)") -imatch '^s') {
        npm install whatsapp-web.js@latest
        npm ls whatsapp-web.js --depth=0
    }
    Pop-Location
}
function Acao-ResetTudo {
    Write-Host "  ATENCAO: apaga TODO o historico de envios (quem ja recebeu pode receber de novo)." -ForegroundColor Red
    if ((Read-Host "  Confirma? (s/N)") -ieq "s") { Sender --reset; Write-Host "  Historico resetado." -ForegroundColor Green }
    else { Write-Host "  Cancelado." -ForegroundColor Yellow }
}
function Acao-ResetRun {
    $r = Read-Host "  runId a remover (ex: 2026-04-08T14-30-00)"
    if ([string]::IsNullOrWhiteSpace($r)) { Write-Host "  runId invalido." -ForegroundColor Red } else { Sender "--reset-run=$r" }
}
function Acao-ExportBlacklist { Sender --export-blacklist }
function Acao-AbrirBlacklist  { Start-Process notepad.exe "$DIR\dados\entrada\blacklist.txt" }

# ---------------------------------------------------------------------------
# Submenu generico: titulo + "o que voce pode verificar aqui" + itens
#   item = @{ k = "1"; t = "texto"; f = { acao } }
# ---------------------------------------------------------------------------
function Run-Submenu($titulo, $cor, $verifica, $itens) {
    while ($true) {
        Show-Titulo $titulo $cor
        Write-Host "  O que voce pode verificar aqui:" -ForegroundColor DarkGray
        foreach ($v in $verifica) { Write-Host "    - $v" -ForegroundColor DarkGray }
        Write-Host ""
        foreach ($it in $itens) { Write-Host ("  [{0}] {1}" -f $it.k, $it.t) -ForegroundColor $cor }
        Write-Host ""
        Write-Host "  [0] Voltar ao menu principal" -ForegroundColor DarkGray
        Write-Host ""
        $op = (Read-Host "  Opcao").Trim()
        if ($op -eq "0" -or $op -eq "") { return }
        $it = $itens | Where-Object { $_.k -ieq $op } | Select-Object -First 1
        if (-not $it) { Write-Host "  Opcao invalida." -ForegroundColor Red; Start-Sleep -Seconds 1; continue }
        Write-Host ""
        & $it.f
        Voltar
    }
}

function Menu-Enviar {
    Run-Submenu "1) ENVIAR (rotina diaria)" "Green" @(
        "Progresso total: enviados, sem WhatsApp, falhas, por zap, categoria e dia  -> [3]",
        "Se a campanha terminou (modo continuo encerra sozinho ao concluir)",
        "Simulacao (dry-run): quem receberia e por qual zap, sem enviar nada  -> [5]"
    ) @(
        @{ k = "1"; t = "MODO CONTINUO - envia sozinho e encerra ao concluir (recomendado)"; f = { Acao-Continuo } },
        @{ k = "2"; t = "PAINEL no navegador: criar campanha com mensagem e publico, AGENDAR, operar por botoes"; f = { Acao-Painel } },
        @{ k = "3"; t = "Ver status: onde parou, totais por zap/categoria/dia"; f = { Acao-Status } },
        @{ k = "4"; t = "Enviar manualmente (disparo completo de uma lista)"; f = { Acao-Enviar "enviar" } },
        @{ k = "5"; t = "Simular envio (dry-run, nao envia nada)"; f = { Acao-Enviar "simular" } },
        @{ k = "6"; t = "Enviar com limite (so uma quantidade)"; f = { Acao-Enviar "limite" } }
    )
}

function Menu-Campanha {
    Run-Submenu "2) CAMPANHA" "Yellow" @(
        "Fechamento: a campanha chegou a 100%? teve falhas? pode ir para a proxima?  -> [2]",
        "Quantos contatos enviados / sem WhatsApp / falhas / pendentes por lista  -> [2] e [5]",
        "Contatos que falharam e podem voltar para a fila  -> [3]"
    ) @(
        @{ k = "1"; t = "Gerar nova lista de disparo (campanha + segmento)"; f = { Acao-GerarLista } },
        @{ k = "2"; t = "Fechamento da campanha (terminou? pode seguir?)"; f = { Acao-Fechamento } },
        @{ k = "3"; t = "Retentar contatos que falharam"; f = { Acao-Retentar } },
        @{ k = "4"; t = "Convite para o grupo de promocoes (link do grupo)"; f = { Acao-ConviteGrupo } },
        @{ k = "5"; t = "Relatorio das ultimas execucoes e progresso de uma lista"; f = { Acao-Relatorio } },
        @{ k = "6"; t = "Gerar Customer Match (Google Ads)"; f = { Acao-CustomerMatch } }
    )
}

function Menu-Zaps {
    Run-Submenu "3) ZAPS (numeros)  - teto 48 envios por zap a cada 24h" "Magenta" @(
        "Quais numeros estao conectados, precisam de QR ou estao pausados  -> [1]",
        "Saldo de cada numero nas ultimas 24h e quando libera a proxima vaga  -> [1]",
        "Se o WhatsApp Web de um zap realmente responde  -> [3]"
    ) @(
        @{ k = "1"; t = "Ver numeros e saldo do dia"; f = { Acao-Zaps } },
        @{ k = "2"; t = "Conectar numero / adicionar zap (QR Code)"; f = { Acao-Conectar } },
        @{ k = "3"; t = "Testar conexao"; f = { Acao-Testar } },
        @{ k = "4"; t = "Desconectar numero (apaga a sessao)"; f = { Acao-Desconectar } },
        @{ k = "5"; t = "Atualizar biblioteca do WhatsApp (se nao conecta / autentica e trava)"; f = { Acao-AtualizarLib } }
    )
}

function Menu-Gestao {
    Run-Submenu "4) GESTAO / TPM" "White" @(
        "KPIs: funil da campanha, vazao por dia, saude dos zaps  -> [1]",
        "Perdas de tempo, riscos e acoes recomendadas  -> [1]",
        "Erros dos ultimos 7 dias  -> [2]"
    ) @(
        @{ k = "1"; t = "Relatorio de gestao (KPIs, perdas, riscos, recomendacoes)"; f = { Acao-Gestao } },
        @{ k = "2"; t = "Ver log de erros (7 dias)"; f = { Acao-Erros } },
        @{ k = "3"; t = "Painel no navegador (aba Gestao)"; f = { Acao-Painel } }
    )
}

function Menu-Manutencao {
    Run-Submenu "5) MANUTENCAO  (cuidado: afeta o historico)" "Red" @(
        "Numeros em opt-out (blacklist): nunca recebem mensagem  -> [3]",
        "Numeros sem WhatsApp que podem ir para a blacklist  -> [2]"
    ) @(
        @{ k = "1"; t = "Remover uma execucao especifica do historico (runId)"; f = { Acao-ResetRun } },
        @{ k = "2"; t = "Exportar numeros sem WhatsApp para a blacklist"; f = { Acao-ExportBlacklist } },
        @{ k = "3"; t = "Abrir a blacklist (editar opt-outs)"; f = { Acao-AbrirBlacklist } },
        @{ k = "9"; t = "RESETAR todo o historico de envios (perigoso)"; f = { Acao-ResetTudo } }
    )
}

function Show-Guia {
    Show-Titulo "GUIA: o que cada area faz" "Yellow"
    Write-Host "  [A] O QUE FAZER AGORA  checklist do dia: zaps sem conexao, campanha terminada, falhas, erros." -ForegroundColor Green
    Write-Host "  [1] ENVIAR       modo continuo (envia e encerra sozinho), PAINEL (aba Nova campanha: mensagem, publico, agendamento), status, envio manual." -ForegroundColor Green
    Write-Host "  [2] CAMPANHA     gerar lista, fechamento (100%?), retentar falhas, convite de grupo, Customer Match." -ForegroundColor Yellow
    Write-Host "  [3] ZAPS         numeros e saldo 24h, conectar por QR, testar, desconectar, atualizar biblioteca." -ForegroundColor Magenta
    Write-Host "  [4] GESTAO       relatorio TPM (KPIs, riscos) e log de erros." -ForegroundColor White
    Write-Host "  [5] MANUTENCAO   blacklist, sem-WhatsApp, limpar historico." -ForegroundColor Red
    Write-Host ""
    Write-Host "  Regras automaticas:" -ForegroundColor Gray
    Write-Host "   - 48 envios por zap a cada 24h; 1 mensagem por telefone por mes; blacklist nunca recebe."
    Write-Host "   - Zap sem conexao ou em quarentena e ignorado (nao perde tempo tentando)."
    Write-Host "   - Zaps aparecem pelo NUMERO; sem numero aparecem como 'Zap N (vazio)'."
    Write-Host "   - Modo continuo encerra ao concluir a campanha e nao reutiliza listas de meses anteriores."
    Write-Host "   - Documentacao: docs\OPERACAO_SECRETARIA.md (rotina) e docs\GESTAO_TPM.md (gestao)."
}

# ---------------------------------------------------------------------------
# Menu principal
# ---------------------------------------------------------------------------
if (-not (Test-Path "$DIR\node_modules")) {
    Write-Host "  Primeira execucao: instalando dependencias (npm install)..." -ForegroundColor Yellow
    Push-Location $DIR; npm install; Pop-Location
}

while ($true) {
    Show-Banner
    Show-Situacao
    Write-Host "  [A] O QUE FAZER AGORA  (checklist do dia)"                                  -ForegroundColor Green
    Write-Host "  [1] ENVIAR             modo continuo, painel, status, envio manual"         -ForegroundColor Green
    Write-Host "  [2] CAMPANHA           gerar lista, fechamento, retentar falhas, grupo"     -ForegroundColor Yellow
    Write-Host "  [3] ZAPS               numeros, saldo 24h, conectar QR, testar"             -ForegroundColor Magenta
    Write-Host "  [4] GESTAO / TPM       KPIs, riscos, log de erros"                          -ForegroundColor White
    Write-Host "  [5] MANUTENCAO         blacklist, sem-WhatsApp, limpar historico"           -ForegroundColor Red
    Write-Host ""
    Write-Host "  [H] Guia: o que cada area faz        [0] Sair"                              -ForegroundColor DarkGray
    Write-Host ""
    $op = (Read-Host "  Opcao").Trim()
    switch ($op.ToLower()) {
        "a" { Write-Host ""; Acao-Hoje; Voltar }
        "1" { Menu-Enviar }
        "2" { Menu-Campanha }
        "3" { Menu-Zaps }
        "4" { Menu-Gestao }
        "5" { Menu-Manutencao }
        "h" { Show-Guia; Voltar }
        "0" { Write-Host "  Ate logo!"; exit 0 }
        default { Write-Host "  Opcao invalida." -ForegroundColor Red; Start-Sleep -Seconds 1 }
    }
}
