$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$repository = "asterlauncher/Aster-Launcher"
$remoteUrl = "https://github.com/$repository.git"
$version = "0.4.8"
$tag = "app-v$version"

Set-Location $projectRoot

$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) {
    $bundledGit = Get-ChildItem `
        -Path "$env:USERPROFILE\.cache\codex-runtimes" `
        -Filter git.exe `
        -File `
        -Recurse `
        -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -like "*\native\git\cmd\git.exe" } |
        Select-Object -First 1
    if ($bundledGit) {
        $gitPath = $bundledGit.FullName
    } else {
        throw "Git was not found. Install Git for Windows and open a new PowerShell window."
    }
} else {
    $gitPath = $git.Source
}

function Invoke-Git {
    & $gitPath @args
    if ($LASTEXITCODE -ne 0) {
        throw "Git command failed: git $($args -join ' ')"
    }
}

$gh = Get-Command gh -ErrorAction SilentlyContinue
if (-not $gh) {
    $installedGh = "C:\Program Files\GitHub CLI\gh.exe"
    if (Test-Path -LiteralPath $installedGh) {
        $ghPath = $installedGh
    } else {
        throw "GitHub CLI was not found. Install it and open a new PowerShell window."
    }
} else {
    $ghPath = $gh.Source
}

& $ghPath auth status
if ($LASTEXITCODE -ne 0) {
    throw "GitHub login is not valid. Run: gh auth login"
}

$packageVersion = (Get-Content package.json | ConvertFrom-Json).version
$tauriVersion = (Get-Content src-tauri\tauri.conf.json | ConvertFrom-Json).version
$cargoVersion = (
    Select-String -Path src-tauri\Cargo.toml -Pattern '^version\s*=\s*"([^"]+)"'
).Matches[0].Groups[1].Value

if (
    $packageVersion -ne $version -or
    $tauriVersion -ne $version -or
    $cargoVersion -ne $version
) {
    throw "Version mismatch. package.json, tauri.conf.json and Cargo.toml must all be $version."
}

$hasUpdateSecret = & $ghPath secret list --repo $repository |
    Select-String -Quiet '^ASTER_UPDATE_PRIVATE_KEY\b'
if (-not $hasUpdateSecret) {
    throw "GitHub secret ASTER_UPDATE_PRIVATE_KEY is missing. Do not publish the update tag."
}

$nestedWebsiteGit = Join-Path $projectRoot "website\website\.git"
if (Test-Path -LiteralPath $nestedWebsiteGit) {
    $websiteGitBackup = Join-Path $projectRoot "backups\website-git"
    if (Test-Path -LiteralPath $websiteGitBackup) {
        throw "Website Git backup already exists at $websiteGitBackup."
    }
    New-Item -ItemType Directory -Path (Split-Path $websiteGitBackup) -Force |
        Out-Null
    Move-Item -LiteralPath $nestedWebsiteGit -Destination $websiteGitBackup
    Write-Host "Moved the nested website Git metadata to backups\website-git."
}

Invoke-Git rm --cached --force --ignore-unmatch rustup-init.exe vs_buildtools.exe
Invoke-Git rm -r --cached --force --ignore-unmatch website/website
Invoke-Git add -A

$staged = @(Invoke-Git diff --cached --name-only)
$unsafe = @(
    $staged | Where-Object {
        (
            $_ -match '(^|/)\.env($|\.)' -and
            $_ -notmatch '(^|/)\.env\.example$'
        ) -or
        $_ -match '(^|/)backups/' -or
        $_ -match '\.(pem|key)$' -or
        $_ -eq 'rustup-init.exe' -or
        $_ -eq 'vs_buildtools.exe'
    }
)
if ($unsafe.Count -gt 0) {
    throw "Unsafe files are staged: $($unsafe -join ', ')"
}

npm.cmd test
npm.cmd run build
Push-Location website\website
try {
    npm.cmd test
} finally {
    Pop-Location
}
Push-Location src-tauri
try {
    cargo check
} finally {
    Pop-Location
}

$configuredGitName = & $gitPath config --get user.name 2>$null
if (-not $configuredGitName) {
    Invoke-Git config user.name "asterlauncher"
}
$configuredGitEmail = & $gitPath config --get user.email 2>$null
if (-not $configuredGitEmail) {
    Invoke-Git config user.email "asterlauncher@gmail.com"
}

$originExists = @(Invoke-Git remote) -contains "origin"
if ($originExists) {
    Invoke-Git remote set-url origin $remoteUrl
} else {
    Invoke-Git remote add origin $remoteUrl
}

Invoke-Git branch -M main
$hasStagedChanges = $true
& $gitPath diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
    $hasStagedChanges = $false
} elseif ($LASTEXITCODE -ne 1) {
    throw "Could not inspect staged Git changes."
}
if ($hasStagedChanges) {
    Invoke-Git commit -m "Publish Aster Launcher 0.4.8 closed alpha"
}

Invoke-Git fetch origin main
& $gitPath merge-base HEAD origin/main *> $null
if ($LASTEXITCODE -ne 0) {
    Invoke-Git merge `
        --allow-unrelated-histories `
        --strategy ours `
        origin/main `
        -m "Merge existing Aster Launcher repository history"
} else {
    Invoke-Git merge origin/main
}

Invoke-Git push -u origin main

& $gitPath rev-parse --verify --quiet "refs/tags/$tag" *> $null
if ($LASTEXITCODE -ne 0) {
    Invoke-Git tag -a $tag -m "Aster Launcher $version closed alpha"
}
Invoke-Git push origin $tag

Write-Host ""
Write-Host "Published $tag."
Write-Host "GitHub Actions is now building and publishing the signed update."
