param(
    [switch]$SkipChecks,
    [switch]$NoWatch,
    [switch]$SkipWebsite
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repository = "asterlauncher/Aster-Launcher"
$version = "0.5.1"
$tag = "app-v$version"
$workspace = Split-Path -Parent $PSScriptRoot
$publishPaths = @(
    ".github/workflows/release.yml",
    "README.md",
    "docs/RELEASE_NOTES.md",
    "docs/VERSION_HISTORY.md",
    "docs/releases/0.5.1.md",
    "package-lock.json",
    "package.json",
    "scripts/create-update-manifest.mjs",
    "scripts/publish-0.5.1.ps1",
    "scripts/publish-website.ps1",
    "scripts/repair-0.5.1-update.ps1",
    "src-tauri/Cargo.lock",
    "src-tauri/Cargo.toml",
    "src-tauri/src/auth/mod.rs",
    "src-tauri/src/commands/instance_commands.rs",
    "src-tauri/src/commands/modpack_commands.rs",
    "src-tauri/src/commands/social_commands.rs",
    "src-tauri/src/content.rs",
    "src-tauri/src/lib.rs",
    "src-tauri/tauri.conf.json",
    "src/components/FriendsHub.tsx",
    "src/config/publicServices.ts",
    "src/hooks/useLauncherUpdater.ts",
    "src/index.css",
    "src/services/presence.ts",
    "src/services/social.ts",
    "website/website/package.json",
    "website/website/scripts/check.mjs",
    "website/website/worker/index.js"
)

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

Set-Location $workspace

$git = Resolve-ReleaseTool "git" @(
    "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe",
    "%ProgramFiles%\Git\cmd\git.exe",
    "%ProgramFiles%\Git\bin\git.exe",
    "%LOCALAPPDATA%\Programs\Git\cmd\git.exe"
)
$gh = Resolve-ReleaseTool "gh" @(
    "%ProgramFiles%\GitHub CLI\gh.exe"
)

Write-Host "Checking GitHub access..." -ForegroundColor Cyan
Invoke-Checked -Program $gh -Arguments @("auth", "status", "--hostname", "github.com")

$remote = (& $git remote get-url origin).Trim()
if ($LASTEXITCODE -ne 0 -or $remote -notmatch "asterlauncher/Aster-Launcher(?:\.git)?$") {
    throw "The origin remote is not the official Aster Launcher repository."
}

$branch = (& $git branch --show-current).Trim()
if ($branch -ne "main") {
    throw "Switch to the main branch before publishing. Current branch: $branch"
}

$currentVersion = (Get-Content "src-tauri/tauri.conf.json" -Raw |
    ConvertFrom-Json).version
if ($currentVersion -ne $version) {
    throw "Expected launcher version $version, found $currentVersion."
}

$missing = $publishPaths | Where-Object { -not (Test-Path -LiteralPath $_) }
if ($missing) {
    throw "Release files are missing: $($missing -join ', ')"
}

if (-not $SkipChecks) {
    Write-Host "Running launcher checks..." -ForegroundColor Cyan
    Invoke-Checked -Program "npm.cmd" -Arguments @("test")
    Invoke-Checked -Program "npm.cmd" -Arguments @("run", "build")
    Invoke-Checked -Program "cargo" -Arguments @(
        "fmt", "--all", "--manifest-path", "src-tauri/Cargo.toml", "--", "--check"
    )
    Invoke-Checked -Program "cargo" -Arguments @(
        "test", "--lib", "--manifest-path", "src-tauri/Cargo.toml"
    )
    Invoke-Checked -Program "npm.cmd" -Arguments @(
        "--prefix", "website/website", "test"
    )
    Invoke-Checked -Program "npm.cmd" -Arguments @(
        "--prefix", "website/website", "run", "build"
    )
}

Write-Host "Synchronizing main without discarding local release work..." -ForegroundColor Cyan
Invoke-Checked -Program $git -Arguments @("pull", "--rebase", "--autostash", "origin", "main")

if (-not (& $git config --get user.name)) {
    Invoke-Checked -Program $git -Arguments @("config", "user.name", "Aster Launcher")
}
if (-not (& $git config --get user.email)) {
    Invoke-Checked -Program $git -Arguments @(
        "config", "user.email", "asterlauncher@gmail.com"
    )
}

Invoke-Checked -Program $git -Arguments (@("add", "--") + $publishPaths)

$staged = @(& $git diff --cached --name-only)
if ($LASTEXITCODE -ne 0) {
    throw "Could not inspect staged release files."
}
if (-not $staged) {
    throw "No 0.5.1 changes are staged."
}

$unexpected = $staged | Where-Object { $publishPaths -notcontains $_ }
if ($unexpected) {
    Invoke-Checked -Program $git -Arguments @("reset")
    throw "Unexpected files reached staging: $($unexpected -join ', ')"
}

$unsafe = $staged | Where-Object {
    $_ -match '(^|/)\.env($|\.)' -or
    $_ -match '(^|/)backups/' -or
    $_ -match '(^|/)target/' -or
    $_ -match '(^|/)node_modules/' -or
    $_ -match 'PRIVATE KEY'
}
if ($unsafe) {
    Invoke-Checked -Program $git -Arguments @("reset")
    throw "Unsafe files were blocked: $($unsafe -join ', ')"
}

$whitespaceCheck = @(& $git diff --cached --check 2>&1)
if ($LASTEXITCODE -ne 0) {
    $whitespaceCheck | ForEach-Object { Write-Host $_ -ForegroundColor Red }
    throw "The staged release contains whitespace errors."
}

$remoteTag = @(& $git ls-remote --tags origin "refs/tags/$tag")
if ($LASTEXITCODE -ne 0) {
    throw "Could not check release tag $tag."
}
if ($remoteTag) {
    throw "Release tag $tag already exists."
}

Invoke-Checked -Program $git -Arguments @(
    "commit", "-m", "Publish Aster Launcher 0.5.1 social sharing"
)
Invoke-Checked -Program $git -Arguments @("push", "origin", "main")
Invoke-Checked -Program $git -Arguments @(
    "tag", "-a", $tag, "-m", "Aster Launcher $version - Social Sharing"
)
Invoke-Checked -Program $git -Arguments @("push", "origin", $tag)

Write-Host ""
Write-Host "Source and tag are public. GitHub is building the signed update." -ForegroundColor Green

if (-not $NoWatch) {
    Start-Sleep -Seconds 5
    $runId = (& $gh run list `
        --repo $repository `
        --workflow "release.yml" `
        --limit 1 `
        --json databaseId `
        --jq ".[0].databaseId").Trim()
    if (-not $runId) {
        throw "The release workflow could not be found."
    }
    Invoke-Checked -Program $gh -Arguments @(
        "run", "watch", $runId, "--repo", $repository, "--exit-status"
    )
}

$releaseAssets = @(& $gh release view $tag `
    --repo $repository `
    --json assets `
    --jq ".assets[].name")
if ($LASTEXITCODE -ne 0) {
    throw "The GitHub release could not be verified."
}
$hasInstaller = $releaseAssets | Where-Object { $_ -match "_x64-setup\.exe$" }
$hasManifest = $releaseAssets | Where-Object { $_ -eq "aster-update.json" }
if (-not $hasInstaller -or -not $hasManifest) {
    throw "The release is incomplete. Installer or aster-update.json is missing."
}

$verificationDirectory = Join-Path $env:TEMP "aster-launcher-update-verification-$version"
New-Item -ItemType Directory -Path $verificationDirectory -Force | Out-Null
Invoke-Checked -Program $gh -Arguments @(
    "release", "download", $tag,
    "--repo", $repository,
    "--pattern", "aster-update.json",
    "--dir", $verificationDirectory,
    "--clobber"
)
$publishedManifest = Get-Content (
    Join-Path $verificationDirectory "aster-update.json"
) -Raw | ConvertFrom-Json
$publishedInstallerUrl = (& $gh release view $tag `
    --repo $repository `
    --json assets `
    --jq '.assets[] | select(.name | endswith("_x64-setup.exe")) | .url').Trim()
Remove-Item -LiteralPath $verificationDirectory -Recurse -Force
if (-not $publishedInstallerUrl -or $publishedManifest.url -ne $publishedInstallerUrl) {
    throw "The update manifest does not point to the published installer asset."
}

if (-not $SkipWebsite) {
    & (Join-Path $PSScriptRoot "publish-website.ps1") -SkipChecks
    if ($LASTEXITCODE -ne 0) {
        throw "The launcher release is public, but the website deployment failed."
    }
}

Write-Host ""
Write-Host "Aster Launcher 0.5.1 is public and update-ready." -ForegroundColor Green
Write-Host "Release: https://github.com/$repository/releases/tag/$tag"
Write-Host "Website: https://aster-launcher.asterlauncher.workers.dev/"
