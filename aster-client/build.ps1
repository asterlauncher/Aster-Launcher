$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$localData = Join-Path $env:LOCALAPPDATA "dev.aster.launcher"
$minecraftRoot = Join-Path $localData "minecraft"
$instanceRoot = Join-Path $localData "instances\aster-1-20-1"
$javaHome = Join-Path $minecraftRoot "runtime\java-runtime-delta"
$javac = Join-Path $javaHome "bin\javac.exe"
$java = Join-Path $javaHome "bin\java.exe"
$jar = Join-Path $javaHome "bin\jar.exe"
$clientJar = Join-Path $instanceRoot ".fabric\remappedJars\minecraft-1.20.1-0.19.3\client-intermediary.jar"
$fabricLoader = Get-ChildItem (Join-Path $minecraftRoot "libraries\net\fabricmc\fabric-loader") -Filter "fabric-loader-*.jar" -Recurse |
    Sort-Object FullName -Descending |
    Select-Object -First 1
$fabricApi = Get-ChildItem (Join-Path $instanceRoot "mods") -Filter "fabric-api-*.jar" |
    Sort-Object FullName -Descending |
    Select-Object -First 1

if (-not (Test-Path $javac) -or -not (Test-Path $java) -or -not (Test-Path $jar)) {
    throw "Launch Aster 1.20.1 once so the Mojang Java 17 runtime is available."
}
if (-not (Test-Path $clientJar)) {
    throw "Launch Aster 1.20.1 once so Fabric can prepare the intermediary client."
}
if (-not $fabricLoader -or -not $fabricApi) {
    throw "Aster 1.20.1 must be provisioned before building the client mod."
}

$buildRoot = Join-Path $PSScriptRoot "build"
$classes = Join-Path $buildRoot "classes"
$dependencies = Join-Path $buildRoot "dependencies"
$output = Join-Path $projectRoot "src-tauri\resources\aster\aster-client-1.20.1.jar"

if (Test-Path $buildRoot) {
    Remove-Item -LiteralPath $buildRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $classes, $dependencies, (Split-Path -Parent $output) | Out-Null

Copy-Item -LiteralPath $fabricApi.FullName -Destination (Join-Path $dependencies "fabric-api.jar")
$localClientJar = Join-Path $dependencies "minecraft-client-intermediary.jar"
$localFabricLoader = Join-Path $dependencies "fabric-loader.jar"
Copy-Item -LiteralPath $clientJar -Destination $localClientJar
Copy-Item -LiteralPath $fabricLoader.FullName -Destination $localFabricLoader
Push-Location $dependencies
& $jar xf "fabric-api.jar"
Pop-Location

$localLibraries = Join-Path $dependencies "libraries"
New-Item -ItemType Directory -Force -Path $localLibraries | Out-Null
$libraryJars = @()
$libraryIndex = 0
$versionManifest = Get-Content (Join-Path $minecraftRoot "versions\1.20.1\1.20.1.json") -Raw |
    ConvertFrom-Json
$versionManifest.libraries |
    ForEach-Object { $_.downloads.artifact.path } |
    Where-Object { $_ } |
    ForEach-Object { Join-Path (Join-Path $minecraftRoot "libraries") $_ } |
    Where-Object { Test-Path $_ } |
    ForEach-Object {
        $libraryIndex += 1
        $localLibrary = Join-Path $localLibraries ("{0:D3}-{1}" -f $libraryIndex, (Split-Path $_ -Leaf))
        Copy-Item -LiteralPath $_ -Destination $localLibrary
        $libraryJars += $localLibrary
    }
$nestedFabricJars = Get-ChildItem (Join-Path $dependencies "META-INF\jars") -Filter "*.jar" |
    Select-Object -ExpandProperty FullName
$classpath = @($localClientJar, $localFabricLoader) + $libraryJars + $nestedFabricJars
$sources = Get-ChildItem (Join-Path $PSScriptRoot "src\main\java") -Filter "*.java" -Recurse |
    Select-Object -ExpandProperty FullName

$compilerClasses = Join-Path $buildRoot "compiler"
New-Item -ItemType Directory -Force -Path $compilerClasses | Out-Null
& $javac -d $compilerClasses (Join-Path $PSScriptRoot "tools\AsterCompiler.java")
if ($LASTEXITCODE -ne 0) {
    throw "The Aster compiler helper could not be built."
}

$classpathFile = Join-Path $buildRoot "classpath.txt"
[IO.File]::WriteAllLines($classpathFile, $classpath, [Text.UTF8Encoding]::new($false))
& $java -cp $compilerClasses AsterCompiler $classes $classpathFile $sources
if ($LASTEXITCODE -ne 0) {
    throw "Aster Client compilation failed."
}

Copy-Item -LiteralPath (Join-Path $PSScriptRoot "src\main\resources\fabric.mod.json") -Destination $classes
Push-Location $classes
& $jar --create --file $output .
Pop-Location

Write-Host "Built $output" -ForegroundColor Green
