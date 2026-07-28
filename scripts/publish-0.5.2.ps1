param(
    [switch]$SkipChecks,
    [switch]$SkipWebsite,
    [string]$Version = "0.5.2"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repository = "asterlauncher/Aster-Launcher"
$version = $Version
$tag = "app-v$version"
$workspace = Split-Path -Parent $PSScriptRoot
$publishPaths = @(
    ".github/workflows/release.yml",
    "docs/RELEASE_NOTES.md",
    "docs/SOCIAL_SETUP.md",
    "docs/VERSION_HISTORY.md",
    "docs/releases/0.5.2.md",
    "docs/releases/$version.md",
    "package-lock.json",
    "package.json",
    "scripts/create-update-manifest.mjs",
    "scripts/publish-0.5.1.ps1",
    "scripts/publish-0.5.2.ps1",
    "scripts/publish-$version.ps1",
    "scripts/publish-website.ps1",
    "scripts/repair-0.5.1-update.ps1",
    "src-tauri/Cargo.lock",
    "src-tauri/Cargo.toml",
    "src-tauri/src/auth/token_store.rs",
    "src-tauri/src/commands/social_commands.rs",
    "src-tauri/src/lib.rs",
    "src-tauri/tauri.conf.json",
    "src/components/FriendsHub.tsx",
    "src/hooks/useLauncherUpdater.ts",
    "src/index.css",
    "src/services/presence.ts",
    "src/services/social.test.ts",
    "src/services/social.ts",
    "supabase/social.sql",
    "website/website/package.json",
    "website/website/scripts/check.mjs",
    "website/website/worker/index.js"
)

function Resolve-Tool {
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

    throw "$Name was not found."
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

function Invoke-GitNetwork {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,
        [switch]$AllowFailure
    )

    $previousExecPath = $env:GIT_EXEC_PATH
    try {
        if ($script:gitNetworkExecPath) {
            $env:GIT_EXEC_PATH = $script:gitNetworkExecPath
        }
        & $script:git @Arguments | Out-Host
        $exitCode = $LASTEXITCODE
    }
    finally {
        $env:GIT_EXEC_PATH = $previousExecPath
    }

    if ($exitCode -ne 0 -and -not $AllowFailure) {
        throw "Git network command failed: git $($Arguments -join ' ')"
    }
    return $exitCode
}

function Get-GitNetworkOutput {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    $previousExecPath = $env:GIT_EXEC_PATH
    try {
        if ($script:gitNetworkExecPath) {
            $env:GIT_EXEC_PATH = $script:gitNetworkExecPath
        }
        $output = @(& $script:git @Arguments)
        $exitCode = $LASTEXITCODE
    }
    finally {
        $env:GIT_EXEC_PATH = $previousExecPath
    }

    if ($exitCode -ne 0) {
        throw "Git network command failed: git $($Arguments -join ' ')"
    }
    return $output
}

Set-Location $workspace

$script:git = Resolve-Tool "git" @(
    "%ProgramFiles%\Git\cmd\git.exe",
    "%LOCALAPPDATA%\Programs\Git\cmd\git.exe",
    "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd\git.exe"
)
$gh = Resolve-Tool "gh" @(
    "%ProgramFiles%\GitHub CLI\gh.exe"
)

$gitCommandDirectory = Split-Path -Parent $git
$gitRoot = Split-Path -Parent $gitCommandDirectory
$bundledNetworkDirectory = Join-Path $gitRoot "mingw64\bin"
$defaultExecPath = (& $git --exec-path).Trim()
$script:gitNetworkExecPath = $null
$temporaryGitExecPath = $null
if (
    -not (Test-Path (Join-Path $defaultExecPath "git-remote-https.exe")) -and
    (Test-Path (Join-Path $bundledNetworkDirectory "git-remote-https.exe"))
) {
    $temporaryGitExecPath = Join-Path $env:TEMP "aster-git-exec-$version"
    New-Item -ItemType Directory -Path $temporaryGitExecPath -Force | Out-Null
    Copy-Item -Path (Join-Path $defaultExecPath "*") `
        -Destination $temporaryGitExecPath -Recurse -Force
    Copy-Item -Path (Join-Path $bundledNetworkDirectory "git-remote-http.exe") `
        -Destination $temporaryGitExecPath -Force
    Copy-Item -Path (Join-Path $bundledNetworkDirectory "git-remote-https.exe") `
        -Destination $temporaryGitExecPath -Force
    $script:gitNetworkExecPath = $temporaryGitExecPath
}

if ($env:PATH -notlike "*$gitCommandDirectory*") {
    $env:PATH = "$gitCommandDirectory;$env:PATH"
}

Write-Host "Checking GitHub access..." -ForegroundColor Cyan
& $gh auth status --hostname github.com
if ($LASTEXITCODE -ne 0) {
    Write-Host "The saved GitHub login expired. Opening a fresh browser login..." -ForegroundColor Yellow
    Invoke-Checked -Program $gh -Arguments @(
        "auth", "login",
        "--hostname", "github.com",
        "--git-protocol", "https",
        "--web"
    )
}
Invoke-Checked -Program $gh -Arguments @(
    "auth", "status", "--hostname", "github.com"
)
Invoke-Checked -Program $gh -Arguments @("auth", "setup-git")

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
    Write-Host "Running launcher and website checks..." -ForegroundColor Cyan
    Invoke-Checked -Program "npm.cmd" -Arguments @("test")
    Invoke-Checked -Program "npm.cmd" -Arguments @("run", "build")
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

Write-Host "Synchronizing the official main branch..." -ForegroundColor Cyan
Invoke-GitNetwork -Arguments @("fetch", "origin", "main")
Invoke-Checked -Program $git -Arguments @(
    "rebase", "--autostash", "origin/main"
)

if (-not (& $git config --get user.name)) {
    Invoke-Checked -Program $git -Arguments @(
        "config", "user.name", "Aster Launcher"
    )
}
if (-not (& $git config --get user.email)) {
    Invoke-Checked -Program $git -Arguments @(
        "config", "user.email", "asterlauncher@gmail.com"
    )
}

$remoteTag = @(
    Get-GitNetworkOutput -Arguments @(
        "ls-remote", "--tags", "origin", "refs/tags/$tag"
    )
)
if ($remoteTag) {
    throw "Release tag $tag already exists."
}

Invoke-Checked -Program $git -Arguments (@("add", "--") + $publishPaths)

$staged = @(& $git diff --cached --name-only)
if ($LASTEXITCODE -ne 0 -or -not $staged) {
    throw "No $version changes are staged."
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

Invoke-Checked -Program $git -Arguments @(
    "commit", "-m", "Publish Aster Launcher $version secure social session hotfix"
)
$commitSha = (& $git rev-parse HEAD).Trim()

$pushExitCode = Invoke-GitNetwork -Arguments @(
    "push", "origin", "main"
) -AllowFailure
if ($pushExitCode -ne 0) {
    Write-Host "Remote changed during publishing; rebasing once and retrying..." -ForegroundColor Yellow
    Invoke-GitNetwork -Arguments @("fetch", "origin", "main")
    Invoke-Checked -Program $git -Arguments @("rebase", "origin/main")
    Invoke-GitNetwork -Arguments @("push", "origin", "main")
    $commitSha = (& $git rev-parse HEAD).Trim()
}

Write-Host "Source is public. Waiting for the signed Windows release..." -ForegroundColor Green
$runId = $null
for ($attempt = 0; $attempt -lt 18 -and -not $runId; $attempt++) {
    Start-Sleep -Seconds 5
    $runId = (& $gh run list `
        --repo $repository `
        --workflow "release.yml" `
        --commit $commitSha `
        --limit 1 `
        --json databaseId `
        --jq ".[0].databaseId").Trim()
}
if (-not $runId) {
    throw "The $version release workflow did not start."
}

Invoke-Checked -Program $gh -Arguments @(
    "run", "watch", $runId,
    "--repo", $repository,
    "--exit-status"
)

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
    throw "The update manifest does not point to the published installer."
}

if (-not $SkipWebsite) {
    & (Join-Path $PSScriptRoot "publish-website.ps1") -SkipChecks
    if ($LASTEXITCODE -ne 0) {
        throw "The launcher is public, but the website deployment failed."
    }
}

if ($temporaryGitExecPath -and (Test-Path -LiteralPath $temporaryGitExecPath)) {
    Remove-Item -LiteralPath $temporaryGitExecPath -Recurse -Force
}

Write-Host ""
Write-Host "Aster Launcher $version is public and update-ready." -ForegroundColor Green
Write-Host "Release: https://github.com/$repository/releases/tag/$tag"
Write-Host "Website: https://aster-launcher.asterlauncher.workers.dev/"
