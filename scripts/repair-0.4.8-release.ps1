$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$repository = "asterlauncher/Aster-Launcher"
$version = "0.4.8"
$tag = "app-v$version"
$builtInstaller = Join-Path $projectRoot (
    "src-tauri\target\release\bundle\nsis\" +
    "Aster Launcher_${version}_x64-setup.exe"
)
$stagingDirectory = Join-Path $env:TEMP "aster-launcher-release-$version"
$installer = Join-Path $stagingDirectory "Aster-Launcher-$version-x64-setup.exe"
$manifest = Join-Path $stagingDirectory "aster-update.json"
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
if (-not (Test-Path -LiteralPath $builtInstaller)) {
    throw "The verified 0.4.8 NSIS installer was not found at $builtInstaller."
}

New-Item -ItemType Directory -Path $stagingDirectory -Force | Out-Null
Copy-Item -LiteralPath $builtInstaller -Destination $installer -Force

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

$releaseJson = & $ghPath release view $tag `
    --repo $repository `
    --json url,tagName,isDraft,isPrerelease,assets
if ($LASTEXITCODE -ne 0) {
    throw "The published release could not be verified."
}

try {
    $releaseInfo = $releaseJson | ConvertFrom-Json
} catch {
    throw "The published release returned invalid metadata."
}

$expectedInstallerName = Split-Path -Leaf $installer
$assetNames = @($releaseInfo.assets | ForEach-Object { $_.name })
if (-not ($assetNames -contains "aster-update.json")) {
    throw "The release is missing the required aster-update.json asset."
}
if (-not ($assetNames -contains $expectedInstallerName)) {
    throw "The release is missing the required installer asset."
}
if ($releaseInfo.isDraft -or $releaseInfo.isPrerelease) {
    throw "The release is not publicly available as a stable release."
}

$latestReleaseJson = & $ghPath release view `
    --repo $repository `
    --json tagName,isDraft,isPrerelease
if ($LASTEXITCODE -ne 0) {
    throw "GitHub's latest release could not be verified."
}

try {
    $latestRelease = $latestReleaseJson | ConvertFrom-Json
} catch {
    throw "GitHub's latest release returned invalid metadata."
}

if ($latestRelease.tagName -ne $tag) {
    throw "GitHub still reports $($latestRelease.tagName) as latest instead of $tag."
}

$publicManifestUrl = (
    "https://github.com/$repository/releases/latest/download/aster-update.json"
)
$publicManifest = $null
for ($attempt = 1; $attempt -le 5; $attempt++) {
    try {
        $publicManifest = Invoke-RestMethod `
            -Uri $publicManifestUrl `
            -Headers @{
                "User-Agent" = "AsterLauncher-ReleaseVerifier"
                "Cache-Control" = "no-cache"
            }
        break
    } catch {
        if ($attempt -eq 5) {
            throw "The public launcher update feed is not reachable at $publicManifestUrl."
        }
        Start-Sleep -Seconds 2
    }
}

if ($publicManifest.version -ne $version) {
    throw "The public update feed reports version $($publicManifest.version) instead of $version."
}
if (-not $publicManifest.url.EndsWith("/$expectedInstallerName")) {
    throw "The public update feed points to the wrong installer asset."
}

Remove-Item -LiteralPath $manifest -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $stagingDirectory -Force -ErrorAction SilentlyContinue
Write-Host ""
Write-Host "Aster Launcher 0.4.8 update assets are published."
Write-Host "Launcher 0.4.7 can now discover the signed update."
