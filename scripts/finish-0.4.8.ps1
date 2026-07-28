$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot

& (Join-Path $PSScriptRoot "publish-0.4.8.ps1")
if ($LASTEXITCODE -ne 0) {
    throw "The source fixes could not be published."
}

& (Join-Path $PSScriptRoot "repair-0.4.8-release.ps1")
if ($LASTEXITCODE -ne 0) {
    throw "The launcher update assets could not be published."
}

Push-Location (Join-Path $projectRoot "website\website")
try {
    npm.cmd run deploy:cloudflare
    if ($LASTEXITCODE -ne 0) {
        throw "The corrected website could not be deployed."
    }
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "Aster Launcher 0.4.8 is complete:"
Write-Host "- Changelog corrected"
Write-Host "- Website deployed"
Write-Host "- Signed launcher update published"
