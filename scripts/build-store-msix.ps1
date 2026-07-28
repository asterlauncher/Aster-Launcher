[CmdletBinding()]
param(
    [string]$PackageVersion,
    [ValidateSet('x64')]
    [string]$Architecture = 'x64'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$tauriConfigPath = Join-Path $projectRoot 'src-tauri\tauri.conf.json'
$manifestTemplatePath = Join-Path $projectRoot 'src-tauri\msix\AppxManifest.template.xml'
$iconRoot = Join-Path $projectRoot 'src-tauri\icons'
$releaseExecutable = Join-Path $projectRoot 'src-tauri\target\release\aster-launcher.exe'
$outputRoot = Join-Path $projectRoot 'dist\store'
$stagingRoot = Join-Path $projectRoot 'src-tauri\target\store-msix'

if (-not (Test-Path -LiteralPath $tauriConfigPath -PathType Leaf)) {
    throw "Tauri configuration was not found at $tauriConfigPath"
}

if ([string]::IsNullOrWhiteSpace($PackageVersion)) {
    $tauriConfig = Get-Content -Raw -LiteralPath $tauriConfigPath | ConvertFrom-Json
    $semanticVersion = [string]$tauriConfig.version
    if ($semanticVersion -notmatch '^(\d+)\.(\d+)\.(\d+)$') {
        throw "Tauri version '$semanticVersion' must use major.minor.patch format."
    }
    $PackageVersion = "$($Matches[1]).$($Matches[2]).$($Matches[3]).0"
}

if ($PackageVersion -notmatch '^\d+\.\d+\.\d+\.\d+$') {
    throw "MSIX package version '$PackageVersion' must use four numeric parts."
}

foreach ($part in $PackageVersion.Split('.')) {
    if ([int64]$part -gt 65535) {
        throw "Every MSIX version part must be between 0 and 65535."
    }
}

$windowsKitBinRoot = 'C:\Program Files (x86)\Windows Kits\10\bin'
$makeAppx = Get-ChildItem -LiteralPath $windowsKitBinRoot -Recurse -File -Filter 'makeappx.exe' |
    Where-Object { $_.FullName -match "\\$Architecture\\makeappx\.exe$" } |
    Sort-Object FullName -Descending |
    Select-Object -First 1

if (-not $makeAppx) {
    throw 'MakeAppx.exe was not found. Install the Windows 10/11 SDK first.'
}

Write-Host "Building Aster Launcher $PackageVersion for the Microsoft Store..."
& npm.cmd run tauri -- build --no-bundle
if ($LASTEXITCODE -ne 0) {
    throw "The Tauri release build failed with exit code $LASTEXITCODE."
}

if (-not (Test-Path -LiteralPath $releaseExecutable -PathType Leaf)) {
    throw "The release executable was not created at $releaseExecutable"
}

New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null

$stagingDirectory = Join-Path $stagingRoot ([guid]::NewGuid().ToString('N'))
$assetDirectory = Join-Path $stagingDirectory 'Assets'
New-Item -ItemType Directory -Path $assetDirectory -Force | Out-Null

try {
    Copy-Item -LiteralPath $releaseExecutable -Destination (Join-Path $stagingDirectory 'aster-launcher.exe')

    $requiredIcons = @(
        'StoreLogo.png',
        'Square44x44Logo.png',
        'Square150x150Logo.png'
    )

    foreach ($icon in $requiredIcons) {
        $sourceIcon = Join-Path $iconRoot $icon
        if (-not (Test-Path -LiteralPath $sourceIcon -PathType Leaf)) {
            throw "Required Store icon is missing: $sourceIcon"
        }
        Copy-Item -LiteralPath $sourceIcon -Destination (Join-Path $assetDirectory $icon)
    }

    $manifest = (Get-Content -Raw -LiteralPath $manifestTemplatePath).
        Replace('__PACKAGE_VERSION__', $PackageVersion)
    Set-Content -LiteralPath (Join-Path $stagingDirectory 'AppxManifest.xml') `
        -Value $manifest `
        -Encoding utf8

    $packagePath = Join-Path $outputRoot "AsterLauncher_${PackageVersion}_${Architecture}.msix"
    & $makeAppx.FullName pack /o /h SHA256 /d $stagingDirectory /p $packagePath
    if ($LASTEXITCODE -ne 0) {
        throw "MakeAppx failed with exit code $LASTEXITCODE."
    }

    $packageHash = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $packageSize = (Get-Item -LiteralPath $packagePath).Length

    Write-Host ''
    Write-Host 'Microsoft Store package created successfully:'
    Write-Host "  Path:    $packagePath"
    Write-Host "  Version: $PackageVersion"
    Write-Host "  Size:    $packageSize bytes"
    Write-Host "  SHA-256: $packageHash"
    Write-Host ''
    Write-Host 'This package is intentionally unsigned. Upload it to Partner Center; Microsoft signs the certified Store package.'
}
finally {
    $resolvedStagingRoot = [System.IO.Path]::GetFullPath($stagingRoot)
    $resolvedStagingDirectory = [System.IO.Path]::GetFullPath($stagingDirectory)
    if ($resolvedStagingDirectory.StartsWith($resolvedStagingRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $resolvedStagingDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
}
