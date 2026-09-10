param(
    [switch]$SkipChecks
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$workspace = Split-Path -Parent $PSScriptRoot
$website = Join-Path $workspace "website\website"

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

Set-Location $website

if (-not $SkipChecks) {
    Invoke-Checked -Program "npm.cmd" -Arguments @("test")
    Invoke-Checked -Program "npm.cmd" -Arguments @("run", "build")
}

Write-Host "Checking Cloudflare sign-in..." -ForegroundColor Cyan
& "npx.cmd" --yes wrangler@latest whoami
if ($LASTEXITCODE -ne 0) {
    Invoke-Checked -Program "npx.cmd" -Arguments @("--yes", "wrangler@latest", "login")
}

Write-Host "Publishing Aster Launcher website..." -ForegroundColor Cyan
Invoke-Checked -Program "npx.cmd" -Arguments @("--yes", "wrangler@latest", "deploy")

Write-Host ""
Write-Host "Aster Launcher website published." -ForegroundColor Green
Write-Host "https://asterlauncher.com/"
