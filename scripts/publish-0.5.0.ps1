param(
    [switch]$SkipChecks,
    [switch]$NoWatch
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repository = "asterlauncher/Aster-Launcher"
$version = "0.5.0"
$tag = "app-v$version"
$workspace = Split-Path -Parent $PSScriptRoot
$publishPaths = @(
    ".github/workflows/release.yml",
    "README.md",
    "docs/RELEASE_NOTES.md",
    "docs/SOCIAL_SETUP.md",
    "docs/VERSION_HISTORY.md",
    "docs/releases/0.5.0.md",
    "package-lock.json",
    "package.json",
    "scripts/publish-0.5.0.ps1",
    "scripts/repair-0.4.8-release.ps1",
    "src-tauri/Cargo.lock",
    "src-tauri/Cargo.toml",
    "src-tauri/src/auth/minecraft.rs",
    "src-tauri/src/auth/mod.rs",
    "src-tauri/src/commands/instance_commands.rs",
    "src-tauri/src/commands/launch_commands.rs",
    "src-tauri/src/commands/mod.rs",
    "src-tauri/src/commands/modpack_commands.rs",
    "src-tauri/src/commands/social_commands.rs",
    "src-tauri/src/commands/update_commands.rs",
    "src-tauri/src/content.rs",
    "src-tauri/src/lib.rs",
    "src-tauri/tauri.conf.json",
    "src/App.tsx",
    "src/components/FriendsHub.tsx",
    "src/components/ModalSystem.tsx",
    "src/components/Notifications.tsx",
    "src/components/SocialNotificationBridge.tsx",
    "src/components/TopBar.tsx",
    "src/hooks/useLauncherPresence.ts",
    "src/hooks/useLauncherSettings.ts",
    "src/hooks/useLauncherUpdater.ts",
    "src/index.css",
    "src/pages/HomePage.tsx",
    "src/pages/SettingsPage.tsx",
    "src/services/launcher.ts",
    "src/services/presence.ts",
    "src/services/settings.test.ts",
    "src/services/settings.ts",
    "src/services/social.test.ts",
    "src/services/social.ts",
    "src/store/AppStore.tsx",
    "src/types/launcher.ts",
    "supabase/social.sql",
    "website/website/package.json",
    "website/website/scripts/check.mjs",
    "website/website/worker/index.js"
)

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Program,
        [Parameter(ValueFromRemainingArguments = $true)]
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

Invoke-Checked -Program $gh -Arguments @("auth", "status", "--hostname", "github.com")

$remote = (& $git remote get-url origin).Trim()
if ($LASTEXITCODE -ne 0 -or $remote -notmatch "asterlauncher/Aster-Launcher(?:\.git)?$") {
    throw "The origin remote is not the official Aster Launcher repository."
}

$currentVersion = (Get-Content "src-tauri/tauri.conf.json" -Raw |
    ConvertFrom-Json).version
if ($currentVersion -ne $version) {
    throw "Expected launcher version $version, found $currentVersion."
}

if (-not $SkipChecks) {
    Invoke-Checked -Program "npm.cmd" -Arguments @("test")
    Invoke-Checked -Program "npm.cmd" -Arguments @("run", "build")
    Invoke-Checked -Program "cargo" -Arguments @(
        "fmt", "--all", "--manifest-path", "src-tauri/Cargo.toml", "--", "--check"
    )
    Invoke-Checked -Program "cargo" -Arguments @(
        "test", "--manifest-path", "src-tauri/Cargo.toml"
    )
    Invoke-Checked -Program "npm.cmd" -Arguments @(
        "--prefix", "website/website", "test"
    )
    Invoke-Checked -Program "npm.cmd" -Arguments @(
        "--prefix", "website/website", "run", "build"
    )
}

$missing = $publishPaths | Where-Object { -not (Test-Path -LiteralPath $_) }
if ($missing) {
    throw "Release files are missing: $($missing -join ', ')"
}

Invoke-Checked -Program $git -Arguments (@("add", "--") + $publishPaths)

$staged = @(& $git diff --cached --name-only)
if ($LASTEXITCODE -ne 0) {
    throw "Could not inspect staged files."
}
if (-not $staged) {
    throw "No 0.5.0 changes are staged."
}

$unsafe = $staged | Where-Object {
    $_ -match '(^|/)\.env($|\.)' -or
    $_ -match '(^|/)backups/' -or
    $_ -match '(^|/)target/' -or
    $_ -match '(^|/)node_modules/' -or
    $_ -match 'PRIVATE KEY'
}
if ($unsafe) {
    Invoke-Checked -Program $git -Arguments (@("reset", "--") + $unsafe)
    throw "Unsafe release files were removed from staging: $($unsafe -join ', ')"
}

$whitespaceCheck = @(& $git diff --cached --check 2>&1)
if ($LASTEXITCODE -ne 0) {
    if ($whitespaceCheck) {
        $whitespaceCheck | ForEach-Object {
            Write-Host $_ -ForegroundColor Red
        }
    }
    throw "The staged release contains whitespace errors."
}

Invoke-Checked -Program $git -Arguments @(
    "commit", "-m", "Publish Aster Launcher 0.5.0 social foundation"
)

Invoke-Checked -Program $git -Arguments @("fetch", "origin", "main")
$divergence = (& $git rev-list --left-right --count "origin/main...HEAD").Trim() -split "\s+"
if ($LASTEXITCODE -ne 0 -or $divergence.Count -ne 2) {
    throw "Could not compare the local release commit with origin/main."
}

$behind = [int]$divergence[0]
if ($behind -gt 0) {
    $actualUnstagedChanges = @(& $git diff --name-only)
    if ($LASTEXITCODE -ne 0) {
        throw "Could not inspect the working tree before rebasing."
    }
    if ($actualUnstagedChanges) {
        throw "Local changes must be committed before rebasing: $($actualUnstagedChanges -join ', ')"
    }
    Invoke-Checked -Program $git -Arguments @("pull", "--rebase", "origin", "main")
} else {
    Write-Host "origin/main is already an ancestor of the release commit; no rebase is needed."
}

Invoke-Checked -Program $git -Arguments @("push", "origin", "main")

$remoteTag = @(& $git ls-remote --tags origin "refs/tags/$tag")
if ($LASTEXITCODE -ne 0) {
    throw "Could not check whether tag $tag already exists."
}
if ($remoteTag) {
    throw "Tag $tag already exists. The source commit was published, but no duplicate release was created."
}

Invoke-Checked -Program $git -Arguments @(
    "tag", "-a", $tag, "-m", "Aster Launcher $version - Aster Social"
)
Invoke-Checked -Program $git -Arguments @("push", "origin", $tag)

Write-Host ""
Write-Host "Aster Launcher $version source and release tag are published." -ForegroundColor Green
Write-Host "GitHub Actions is now building the signed public installer."

if (-not $NoWatch) {
    Start-Sleep -Seconds 5
    $runId = (& $gh run list `
        --repo $repository `
        --workflow "release.yml" `
        --limit 1 `
        --json databaseId `
        --jq ".[0].databaseId").Trim()
    if ($LASTEXITCODE -eq 0 -and $runId) {
        Invoke-Checked -Program $gh -Arguments @(
            "run", "watch", $runId, "--repo", $repository, "--exit-status"
        )
    } else {
        Write-Warning "The workflow was started, but its run could not be opened automatically."
    }
}

Write-Host "Release: https://github.com/$repository/releases/tag/$tag"
