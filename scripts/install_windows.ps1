<#
.SYNOPSIS
    ODEN — installerar valvet och Oden på Windows.

.DESCRIPTION
    Windows-motsvarigheten till scripts/install_system.sh. Hämtar senaste
    ODEN-valv, installerar Oden via dess egen Inno Setup-installerare, och
    skriver ut de manuella stegen (Obsidian + setup-wizard + kartnyckel).

    Principer, samma som på macOS: ingen administratörsbehörighet, skriver aldrig
    över ett befintligt valv, hoppar över det som redan finns, och Obsidian
    installeras aldrig automatiskt (proprietärt).

.PARAMETER Pr
    Pull request-nummer i Oden, t.ex. 269. Slår upp den senaste
    förhandsutgåvan för den PR:en. Använd detta hellre än -Tag: taggen
    innehåller commitens sha och byter namn vid varje ny commit.

.PARAMETER Tag
    En exakt Oden-tagg, t.ex. pr-269-snapshot-e76310f eller v4.0.1.

.PARAMETER Channel
    release (default) eller snapshot för senaste testbygget av Odens main.

.PARAMETER Variant
    release (default) ger det operativa valvet, training ger övningsvalvet
    med demokassetter. (Heter inte -Profile: $Profile är upptaget i PowerShell.)

.PARAMETER VaultParent
    Katalogen valvet packas upp i. Default $env:USERPROFILE — medvetet inte
    Dokument, som OneDrive ofta synkar.

.EXAMPLE
    .\install.ps1 -Pr 269
#>
#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$Pr,
    [string]$Tag,
    [ValidateSet('release', 'snapshot')][string]$Channel = 'release',
    [ValidateSet('release', 'training')][string]$Variant = 'release',
    [string]$VaultParent = $env:USERPROFILE,
    [switch]$SkipVault,
    [switch]$SkipOden
)

$ErrorActionPreference = 'Stop'

$AnalysRepo = 'larsnor/ODEN-analys'
$OdenRepo = 'NicklasAndersson/oden'
$OdenInstallDir = Join-Path $env:LOCALAPPDATA 'Programs\Oden'

function Write-Info { param([string]$m) Write-Host "i  $m" -ForegroundColor Blue }
function Write-Ok { param([string]$m) Write-Host "OK $m" -ForegroundColor Green }
function Write-Warn { param([string]$m) Write-Host "!  $m" -ForegroundColor Yellow }
function Fail { param([string]$m) Write-Host "X  $m" -ForegroundColor Red; exit 1 }

if ($env:OS -ne 'Windows_NT') { Fail 'Det här skriptet är för Windows. På macOS: scripts/install_system.sh' }

# PowerShell 5.1 förhandlar TLS 1.0 som default, och GitHub svarar inte på det.
# Utan den här raden faller varje anrop nedan med ett obegripligt SSL-fel.
try {
    [Net.ServicePointManager]::SecurityProtocol =
    [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
}
catch { Write-Warn "Kunde inte sätta TLS 1.2 ($($_.Exception.Message)) — fortsätter." }

function Get-Json {
    param([string]$Url)
    Invoke-RestMethod -Uri $Url -Headers @{ 'Accept' = 'application/vnd.github+json' } -UseBasicParsing
}

function Get-Asset {
    <# Namn + URL för den första asseten som matchar mönstret. #>
    param($Release, [string]$Pattern)
    $Release.assets | Where-Object { $_.name -like $Pattern } | Select-Object -First 1
}

function Resolve-OdenRelease {
    <# Vilken Oden-utgåva som ska installeras, utifrån -Pr / -Tag / -Channel. #>
    if ($Pr) {
        Write-Info "Letar efter testbygget för PR #$Pr …"
        $prefix = "pr-$Pr-snapshot-"
        $hit = Get-Json "https://api.github.com/repos/$OdenRepo/releases?per_page=100" |
        Where-Object { -not $_.draft -and $_.tag_name.StartsWith($prefix) } |
        Sort-Object -Property created_at -Descending | Select-Object -First 1
        if (-not $hit) {
            Fail ("Hittade inget testbygge för PR #$Pr. Bygget görs först när PR:en har " +
                'etiketten snapshot-release — be den som äger repot att sätta den.')
        }
        return $hit
    }
    if ($Tag) { return Get-Json "https://api.github.com/repos/$OdenRepo/releases/tags/$Tag" }
    if ($Channel -eq 'snapshot') {
        $hit = Get-Json "https://api.github.com/repos/$OdenRepo/releases?per_page=100" |
        Where-Object { $_.prerelease -and -not $_.draft -and $_.tag_name.StartsWith('snapshot-') } |
        Sort-Object -Property created_at -Descending | Select-Object -First 1
        if (-not $hit) { Fail 'Hittade ingen snapshot av main.' }
        return $hit
    }
    return Get-Json "https://api.github.com/repos/$OdenRepo/releases/latest"
}

function Get-InstalledOdenVersion {
    <# DisplayVersion ur avinstallationsnyckeln. Tom sträng när Oden inte finns. #>
    $roots = @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
    )
    foreach ($root in $roots) {
        if (-not (Test-Path $root)) { continue }
        $key = Get-ChildItem $root -ErrorAction SilentlyContinue |
        ForEach-Object { Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue } |
        Where-Object { $_.DisplayName -eq 'Oden' } | Select-Object -First 1
        if ($key) { return [string]$key.DisplayVersion }
    }
    if (Test-Path (Join-Path $OdenInstallDir 'Oden.exe')) { return 'okänd' }
    return ''
}

Write-Host ''
if ($Variant -eq 'training') {
    Write-Host '=== ODEN — installation av hela systemet (ÖVNINGSVARIANT) ===' -ForegroundColor White
}
else {
    Write-Host '=== ODEN — installation av hela systemet ===' -ForegroundColor White
}
Write-Host ''

# --- 1. Valvet --------------------------------------------------------------
$assetPrefix = if ($Variant -eq 'training') { 'ODEN-ovning-' } else { 'ODEN-valv-' }
$vaultDir = $null

if ($SkipVault) {
    Write-Info 'Hoppar över valvet (-SkipVault).'
}
else {
    if (-not (Test-Path $VaultParent)) { New-Item -ItemType Directory -Path $VaultParent -Force | Out-Null }
    $VaultParent = (Resolve-Path $VaultParent).Path

    if ($env:OneDrive -and $VaultParent.StartsWith($env:OneDrive, 'OrdinalIgnoreCase')) {
        Write-Warn 'Valvet hamnar under OneDrive. Oden skriver filer live samtidigt som'
        Write-Warn 'Obsidian bevakar och skriver — i en synkklient ger det fillås,'
        Write-Warn 'dubblettfiler och halvskrivna rapporter. Välj -VaultParent C:\ i stället.'
    }

    Write-Info "Hämtar senaste valvet från $AnalysRepo …"
    $analys = Get-Json "https://api.github.com/repos/$AnalysRepo/releases/latest"
    $asset = Get-Asset $analys "$assetPrefix*.zip"
    if (-not $asset) { Fail "Hittade ingen $assetPrefix*.zip i senaste releasen ($AnalysRepo)." }

    $zip = Join-Path ([IO.Path]::GetTempPath()) $asset.name
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip -UseBasicParsing
    try {
        # Toppmappens namn läses ur zippen i stället för att skrivas här: den heter
        # ODEN-övning med omljud, och ett hårdkodat namn i det här skriptet
        # riskerar teckenkodningen på vägen hit.
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $archive = [IO.Compression.ZipFile]::OpenRead($zip)
        try {
            $topName = ($archive.Entries[0].FullName -split '/')[0]
        }
        finally { $archive.Dispose() }

        $vaultDir = Join-Path $VaultParent $topName
        if (Test-Path $vaultDir) {
            Write-Ok "Valvet finns redan: $vaultDir (rörs inte — ett valv skrivs aldrig över)"
        }
        else {
            Expand-Archive -Path $zip -DestinationPath $VaultParent -Force
            if (-not (Test-Path $vaultDir)) { Fail "Uppackningen gav inte $vaultDir — kontrollera zip-innehållet." }
            Write-Ok "Valv på plats: $vaultDir"
        }
    }
    finally { Remove-Item $zip -Force -ErrorAction SilentlyContinue }
}

# --- 2. Oden ----------------------------------------------------------------
if ($SkipOden) {
    Write-Info 'Hoppar över Oden (-SkipOden).'
}
else {
    $pinned = [bool]($Pr -or $Tag)
    $installed = Get-InstalledOdenVersion
    $release = $null

    if ($installed -and -not $pinned) {
        Write-Ok "Oden finns redan (version $installed — hoppar över)"
    }
    else {
        $release = Resolve-OdenRelease
        $exeAsset = Get-Asset $release 'Oden-Setup-*-x64.exe'
        if (-not $exeAsset) {
            Fail "Utgåvan $($release.tag_name) har ingen Windows-installerare (Oden-Setup-*-x64.exe)."
        }

        if ($installed -eq $release.tag_name) {
            Write-Ok "Oden är redan den begärda byggnationen ($installed — hoppar över)"
        }
        else {
            if (Get-Process -Name 'Oden' -ErrorAction SilentlyContinue) {
                Fail 'Oden kör — avsluta appen och kör kommandot igen (valvet rörs inte).'
            }
            if ($installed) { Write-Info "Ersätter Oden $installed med $($release.tag_name) …" }
            Write-Info "Installerar Oden $($release.tag_name) …"

            $exe = Join-Path ([IO.Path]::GetTempPath()) $exeAsset.name
            Invoke-WebRequest -Uri $exeAsset.browser_download_url -OutFile $exe -UseBasicParsing
            # Filen kommer från nätet, så Windows märker den. Utan detta stoppar
            # SmartScreen en installerare som användaren uttryckligen bett om.
            Unblock-File -Path $exe -ErrorAction SilentlyContinue
            try {
                $proc = Start-Process -FilePath $exe `
                    -ArgumentList '/SILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -Wait -PassThru
                if ($proc.ExitCode -ne 0) { Fail "Installeraren avslutade med kod $($proc.ExitCode)." }
            }
            finally { Remove-Item $exe -Force -ErrorAction SilentlyContinue }
            Write-Ok "Oden installerad i $OdenInstallDir"
        }
    }
}

# --- 3. Manuella steg -------------------------------------------------------
Write-Host ''
Write-Host '=== Klart att installera — så här fortsätter du ===' -ForegroundColor White
Write-Host ''
if (Test-Path (Join-Path $env:LOCALAPPDATA 'Obsidian\Obsidian.exe')) {
    Write-Host '1. Obsidian är redan installerat ✓'
}
else {
    Write-Host '1. Installera Obsidian (gratis): https://obsidian.md/download'
}
$shown = if ($vaultDir) { $vaultDir } else { Join-Path $VaultParent 'ODEN-valv' }
Write-Host "2. Öppna valvet: Obsidian → 'Open folder as vault' → $shown"
Write-Host "   → svara 'Trust author and enable plugins'. Noten Välkommen.md leder vidare."
Write-Host '3. Starta Oden från Start-menyn och kör setup-wizarden (http://127.0.0.1:8080):'
Write-Host '   - Länka Signal-kontot (QR-kod; använd ett dedikerat nummer, inte ditt privata)'
Write-Host "   - Vault-sökväg: $shown"
Write-Host '   - Obsidian-mallsteget: HOPPA ÖVER — valvet är redan komplett konfigurerat'
Write-Host '4. Rekommenderat: låt rapporterna landa i inkorg/ i stället för en mapp per'
Write-Host '   Signal-grupp. Konfiguration → Katalogstruktur → stäng av Grupp uppdelning;'
Write-Host '   Pipelines → 7S RAPPORT → Underkatalog = inkorg → Spara.'
Write-Host ''
Write-Ok 'Klart.'
