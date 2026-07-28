param(
    [switch]$NoWatch
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repository = "asterlauncher/Aster-Launcher"
$version = "0.5.0"
$tag = "app-v$version"
$workspace = Split-Path -Parent $PSScriptRoot

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

Invoke-Checked -Program $gh -Arguments @("auth", "status", "--hostname", "github.com")

$currentVersion = (Get-Content "src-tauri/tauri.conf.json" -Raw |
    ConvertFrom-Json).version
if ($currentVersion -ne $version) {
    throw "Expected launcher version $version, found $currentVersion."
}

$headSubject = (& $git log -1 --pretty=format:%s).Trim()
if ($LASTEXITCODE -ne 0 -or
    $headSubject -ne "Publish Aster Launcher 0.5.0 social foundation") {
    throw "The prepared 0.5.0 release commit is not checked out."
}

# Include the corrected publishing workflow in the already-created release
# commit instead of producing a second maintenance commit.
Invoke-Checked -Program $git -Arguments @(
    "add", "--",
    "scripts/publish-0.5.0.ps1",
    "scripts/resume-publish-0.5.0.ps1"
)
Invoke-Checked -Program $git -Arguments @("commit", "--amend", "--no-edit")

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
    Write-Host "The release commit is already based on the latest origin/main."
}

Invoke-Checked -Program $git -Arguments @("push", "origin", "main")

$remoteTag = @(& $git ls-remote --tags origin "refs/tags/$tag")
if ($LASTEXITCODE -ne 0) {
    throw "Could not check whether tag $tag already exists."
}
if ($remoteTag) {
    throw "Tag $tag already exists. The source commit was pushed, but no duplicate tag was created."
}

Invoke-Checked -Program $git -Arguments @(
    "tag", "-a", $tag, "-m", "Aster Launcher $version - Aster Social"
)
Invoke-Checked -Program $git -Arguments @("push", "origin", $tag)

Write-Host ""
Write-Host "Aster Launcher $version is published." -ForegroundColor Green
Write-Host "GitHub Actions is building the signed installer."

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
        Write-Warning "The workflow started, but could not be opened automatically."
    }
}

Write-Host "Release: https://github.com/$repository/releases/tag/$tag"
