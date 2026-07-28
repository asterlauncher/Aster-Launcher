param(
    [switch]$SkipChecks,
    [switch]$SkipWebsite
)

$arguments = @{
    Version = "0.5.3"
}
if ($SkipChecks) {
    $arguments.SkipChecks = $true
}
if ($SkipWebsite) {
    $arguments.SkipWebsite = $true
}

& (Join-Path $PSScriptRoot "publish-0.5.2.ps1") @arguments
exit $LASTEXITCODE
