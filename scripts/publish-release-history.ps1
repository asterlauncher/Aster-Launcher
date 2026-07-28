[CmdletBinding()]
param(
    [string]$Repository = 'asterlauncher/Aster-Launcher'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$versions = @(
    '0.1.0',
    '0.2.0',
    '0.3.0',
    '0.4.0',
    '0.4.1',
    '0.4.2',
    '0.4.3',
    '0.4.4',
    '0.4.5',
    '0.4.6',
    '0.4.7'
)

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw 'GitHub CLI is not installed. Install it and run gh auth login first.'
}

gh auth status
if ($LASTEXITCODE -ne 0) {
    throw 'GitHub CLI is not authenticated. Run gh auth login first.'
}

gh repo edit $Repository `
    --description 'A native Windows launcher for Minecraft Java, modpacks, and community content.'
if ($LASTEXITCODE -ne 0) {
    throw "The authenticated account cannot edit $Repository."
}

function Publish-RepositoryFile {
    param(
        [Parameter(Mandatory)]
        [string]$LocalPath,
        [Parameter(Mandatory)]
        [string]$RepositoryPath,
        [Parameter(Mandatory)]
        [string]$CommitMessage
    )

    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    gh api "repos/$Repository/contents/$RepositoryPath" *> $null
    $repositoryFileExists = $LASTEXITCODE -eq 0
    $ErrorActionPreference = $previousErrorActionPreference
    if ($repositoryFileExists) {
        return
    }

    $bytes = [System.IO.File]::ReadAllBytes($LocalPath)
    $payload = @{
        message = $CommitMessage
        content = [Convert]::ToBase64String($bytes)
    } | ConvertTo-Json
    $payloadPath = Join-Path ([System.IO.Path]::GetTempPath()) "aster-github-$([Guid]::NewGuid().ToString('N')).json"
    try {
        [System.IO.File]::WriteAllText($payloadPath, $payload, [System.Text.UTF8Encoding]::new($false))
        gh api --method PUT "repos/$Repository/contents/$RepositoryPath" --input $payloadPath
        if ($LASTEXITCODE -ne 0) {
            throw "Could not publish $RepositoryPath."
        }
    } finally {
        if (Test-Path -LiteralPath $payloadPath) {
            Remove-Item -LiteralPath $payloadPath -Force
        }
    }
}

Publish-RepositoryFile `
    -LocalPath (Join-Path $projectRoot 'README.md') `
    -RepositoryPath 'README.md' `
    -CommitMessage 'Add Aster Launcher repository overview'
Publish-RepositoryFile `
    -LocalPath (Join-Path $projectRoot 'docs\VERSION_HISTORY.md') `
    -RepositoryPath 'docs/VERSION_HISTORY.md' `
    -CommitMessage 'Add complete Aster Launcher version history'

$privateKey = Join-Path $projectRoot 'backups\updater\aster-update-private.pem'
if (-not (Test-Path -LiteralPath $privateKey -PathType Leaf)) {
    throw "The updater private key is missing from $privateKey"
}
Get-Content -LiteralPath $privateKey -Raw |
    gh secret set ASTER_UPDATE_PRIVATE_KEY --repo $Repository
if ($LASTEXITCODE -ne 0) {
    throw 'Could not configure the update signing secret.'
}

foreach ($version in $versions) {
    $tag = "app-v$version"
    $notes = Join-Path $projectRoot "docs\releases\$version.md"
    $nsis = Join-Path $projectRoot "src-tauri\target\release\bundle\nsis\Aster Launcher_${version}_x64-setup.exe"
    $msi = Join-Path $projectRoot "src-tauri\target\release\bundle\msi\Aster Launcher_${version}_x64_en-US.msi"

    foreach ($requiredFile in @($notes, $nsis, $msi)) {
        if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
            throw "Missing release file: $requiredFile"
        }
    }

    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    gh release view $tag --repo $Repository *> $null
    $releaseExists = $LASTEXITCODE -eq 0
    $ErrorActionPreference = $previousErrorActionPreference
    if ($releaseExists) {
        gh release edit $tag `
            --repo $Repository `
            --title "Aster Launcher v$version" `
            --notes-file $notes
    } else {
        gh release create $tag `
            --repo $Repository `
            --target main `
            --title "Aster Launcher v$version" `
            --notes-file $notes
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Could not publish release $tag."
    }

    gh release upload $tag $nsis $msi --repo $Repository --clobber
    if ($LASTEXITCODE -ne 0) {
        throw "Could not upload the installers for $tag."
    }
}

$latestInstaller = Join-Path $projectRoot 'src-tauri\target\release\bundle\nsis\Aster Launcher_0.4.7_x64-setup.exe'
$manifest = Join-Path $projectRoot 'aster-update.json'
node (Join-Path $projectRoot 'scripts\create-update-manifest.mjs') $latestInstaller $manifest
if ($LASTEXITCODE -ne 0) {
    throw 'Could not create the signed 0.4.7 update manifest.'
}

gh release upload 'app-v0.4.7' $manifest --repo $Repository --clobber
if ($LASTEXITCODE -ne 0) {
    throw 'Could not upload the signed 0.4.7 update manifest.'
}

Remove-Item -LiteralPath $manifest -Force
Write-Host "Published all Aster Launcher releases to https://github.com/$Repository/releases"
