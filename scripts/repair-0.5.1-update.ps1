param(
    [string]$Version = "0.5.1"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repository = "asterlauncher/Aster-Launcher"
$tag = "app-v$Version"
$workspace = Split-Path -Parent $PSScriptRoot
$stagingDirectory = Join-Path $env:TEMP "aster-launcher-update-repair-$Version"
$downloadedInstaller = Join-Path $stagingDirectory "installer.exe"
$manifest = Join-Path $stagingDirectory "aster-update.json"

function Resolve-ReleaseTool {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [string[]]$FallbackPaths = @()
    )

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    foreach ($candidate in $FallbackPaths) {
        $expanded = [Environment]::ExpandEnvironmentVariables($candidate)
        if (Test-Path -LiteralPath $expanded) {
            return (Resolve-Path -LiteralPath $expanded).Path
        }
    }

    throw "$Name was not found. Install it or add it to PATH."
}

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Program,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed: $Program $($Arguments -join ' ')"
    }
}

Set-Location $workspace
$gh = Resolve-ReleaseTool "gh" @("%ProgramFiles%\GitHub CLI\gh.exe")

& $gh auth status --hostname github.com
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "GitHub login expired. Opening the browser login once..." -ForegroundColor Yellow
    Invoke-Checked -Program $gh -Arguments @(
        "auth", "login",
        "--hostname", "github.com",
        "--git-protocol", "https",
        "--web"
    )
}

$releaseJson = & $gh release view $tag `
    --repo $repository `
    --json tagName,isDraft,isPrerelease,assets
if ($LASTEXITCODE -ne 0) {
    throw "The $tag release could not be read."
}
$release = $releaseJson | ConvertFrom-Json
if ($release.isDraft -or $release.isPrerelease) {
    throw "The $tag release is not public and stable."
}

$installers = @(
    $release.assets |
        Where-Object { $_.name -match '_x64-setup\.exe$' }
)
if ($installers.Count -ne 1) {
    throw "Exactly one NSIS installer must exist in $tag."
}
$publishedInstaller = $installers[0]

Remove-Item -LiteralPath $stagingDirectory -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $stagingDirectory -Force | Out-Null

Invoke-Checked -Program $gh -Arguments @(
    "release", "download", $tag,
    "--repo", $repository,
    "--pattern", $publishedInstaller.name,
    "--dir", $stagingDirectory,
    "--clobber"
)
$downloadedAsset = Join-Path $stagingDirectory $publishedInstaller.name
Move-Item -LiteralPath $downloadedAsset -Destination $downloadedInstaller -Force

Invoke-Checked -Program "node" -Arguments @(
    "scripts/create-update-manifest.mjs",
    $downloadedInstaller,
    $manifest,
    $publishedInstaller.url
)
Invoke-Checked -Program $gh -Arguments @(
    "release", "upload", $tag,
    $manifest,
    "--repo", $repository,
    "--clobber"
)

Remove-Item -LiteralPath $manifest -Force
Invoke-Checked -Program $gh -Arguments @(
    "release", "download", $tag,
    "--repo", $repository,
    "--pattern", "aster-update.json",
    "--dir", $stagingDirectory,
    "--clobber"
)
$verifiedManifest = Get-Content $manifest -Raw | ConvertFrom-Json
if ($verifiedManifest.url -ne $publishedInstaller.url) {
    throw "The published manifest still points to the wrong installer."
}

Remove-Item -LiteralPath $stagingDirectory -Recurse -Force
Write-Host ""
Write-Host "Aster Launcher $Version update feed repaired." -ForegroundColor Green
Write-Host "Installer: $($publishedInstaller.name)"
Write-Host "Feed: https://github.com/$repository/releases/latest/download/aster-update.json"
