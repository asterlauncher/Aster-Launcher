$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$repository = "asterlauncher/Aster-Launcher"
$version = "0.4.8"
$tag = "app-v$version"
$installer = Join-Path $projectRoot (
    "src-tauri\target\release\bundle\nsis\" +
    "Aster Launcher_${version}_x64-setup.exe"
)
$manifest = Join-Path $env:TEMP "aster-update-$version.json"
$releaseNotes = Join-Path $projectRoot "docs\RELEASE_NOTES.md"

Set-Location $projectRoot

$gh = Get-Command gh -ErrorAction SilentlyContinue
if ($gh) {
    $ghPath = $gh.Source
} elseif (Test-Path -LiteralPath "C:\Program Files\GitHub CLI\gh.exe") {
    $ghPath = "C:\Program Files\GitHub CLI\gh.exe"
} else {
    throw "GitHub CLI was not found."
}

& $ghPath auth status
if ($LASTEXITCODE -ne 0) {
    throw "GitHub login is not valid. Run: gh auth login"
}
if (-not (Test-Path -LiteralPath $installer)) {
    throw "The verified 0.4.8 NSIS installer was not found at $installer."
}

node scripts\create-update-manifest.mjs $installer $manifest
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $manifest)) {
    throw "The signed update manifest could not be created."
}

& $ghPath release view $tag --repo $repository *> $null
$releaseExists = $LASTEXITCODE -eq 0

if ($releaseExists) {
    & $ghPath release upload $tag $installer $manifest `
        --repo $repository `
        --clobber
    if ($LASTEXITCODE -ne 0) {
        throw "The release assets could not be uploaded."
    }
    & $ghPath release edit $tag `
        --repo $repository `
        --title "Aster Launcher v$version" `
        --notes-file $releaseNotes `
        --draft=false `
        --prerelease=false `
        --latest
    if ($LASTEXITCODE -ne 0) {
        throw "The release metadata could not be updated."
    }
} else {
    & $ghPath release create $tag $installer $manifest `
        --repo $repository `
        --verify-tag `
        --title "Aster Launcher v$version" `
        --notes-file $releaseNotes `
        --latest
    if ($LASTEXITCODE -ne 0) {
        throw "The 0.4.8 release could not be created."
    }
}

& $ghPath release view $tag `
    --repo $repository `
    --json url,isLatest,assets
if ($LASTEXITCODE -ne 0) {
    throw "The published release could not be verified."
}

Remove-Item -LiteralPath $manifest -Force -ErrorAction SilentlyContinue
Write-Host ""
Write-Host "Aster Launcher 0.4.8 update assets are published."
Write-Host "Launcher 0.4.7 can now discover the signed update."
