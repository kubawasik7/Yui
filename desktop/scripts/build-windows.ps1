$ErrorActionPreference = 'Stop'

$desktopRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$repoRoot = (Resolve-Path (Join-Path $desktopRoot '..')).Path
$frontendRoot = Join-Path $repoRoot 'frontend'
$backendRoot = Join-Path $repoRoot 'backend'
$resourceRoot = Join-Path $desktopRoot 'resources'
$runtimeRoot = Join-Path $resourceRoot 'runtime'
$backendResourceRoot = Join-Path $resourceRoot 'backend'

function Invoke-CheckedCommand([string]$Command, [string[]]$Arguments, [string]$WorkingDirectory) {
    Push-Location $WorkingDirectory
    try {
        & $Command @Arguments
        if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE." }
    }
    finally {
        Pop-Location
    }
}

function Get-NativeCommandOutput([string]$Command, [string]$Arguments) {
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $Command
    $startInfo.Arguments = $Arguments
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = [System.Diagnostics.Process]::Start($startInfo)
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw "$Command failed with exit code $($process.ExitCode)." }
    $standardOutput = $stdoutTask.GetAwaiter().GetResult()
    $standardError = $stderrTask.GetAwaiter().GetResult()
    return "$standardOutput`n$standardError"
}

if (-not (Test-Path (Join-Path $desktopRoot 'node_modules\electron-builder\cli.js'))) {
    throw 'Desktop dependencies are missing. Run npm ci in the desktop folder first.'
}

Invoke-CheckedCommand 'npm.cmd' @('run', 'build') $frontendRoot
Invoke-CheckedCommand 'mvn.cmd' @('-DskipTests', 'package') $backendRoot

$jar = Get-ChildItem (Join-Path $backendRoot 'target') -Filter 'yui-api-*.jar' -File |
    Where-Object { $_.Name -notlike '*.original' } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if (-not $jar) { throw 'Spring Boot executable JAR was not produced.' }

$javaHome = $env:JAVA_HOME
if (-not $javaHome) {
    $javaCommand = Get-Command 'java.exe' -ErrorAction SilentlyContinue
    if ($javaCommand) {
        $javaSettings = Get-NativeCommandOutput $javaCommand.Source '-XshowSettings:properties -version'
        $homeMatch = [regex]::Match($javaSettings, 'java\.home\s*=\s*(.+)')
        if ($homeMatch.Success) { $javaHome = $homeMatch.Groups[1].Value.Trim() }
    }
}
if (-not $javaHome) {
    throw 'A JDK with jlink is required on the build computer. The installed app includes the resulting Java runtime.'
}
$jdkBin = Join-Path $javaHome 'bin'
$jlink = Join-Path $jdkBin 'jlink.exe'
$jmods = Join-Path $javaHome 'jmods'
if (-not (Test-Path $jlink) -or -not (Test-Path $jmods)) {
    throw 'Could not locate jlink.exe and the JDK jmods folder. Set JAVA_HOME to a full JDK installation.'
}
$versionOutput = Get-NativeCommandOutput (Join-Path $jdkBin 'java.exe') '-version'
$versionMatch = [regex]::Match($versionOutput, 'version "(\d+)')
if (-not $versionMatch.Success -or [int]$versionMatch.Groups[1].Value -lt 21) {
    throw 'The JDK used to build the bundled runtime must be version 21 or newer.'
}

New-Item -ItemType Directory -Force -Path $resourceRoot, $backendResourceRoot | Out-Null
Copy-Item -LiteralPath $jar.FullName -Destination (Join-Path $backendResourceRoot 'yui-api.jar') -Force
Invoke-CheckedCommand 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $desktopRoot 'installer-assets\generate-branding.ps1')) $desktopRoot

if (Test-Path $runtimeRoot) {
    $resolvedRuntime = (Resolve-Path $runtimeRoot).Path
    if (-not $resolvedRuntime.StartsWith($resourceRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Refusing to remove runtime output outside desktop/resources.'
    }
    Remove-Item -LiteralPath $resolvedRuntime -Recurse -Force
}

& $jlink --module-path $jmods --add-modules java.se,jdk.crypto.ec,jdk.unsupported,jdk.localedata,jdk.charsets,jdk.zipfs --strip-debug --no-man-pages --no-header-files --compress zip-6 --output $runtimeRoot
if ($LASTEXITCODE -ne 0) { throw "jlink failed with exit code $LASTEXITCODE." }

Invoke-CheckedCommand 'npx.cmd' @('electron-builder', '--win', 'nsis', '--x64') $desktopRoot

$engine = Get-ChildItem (Join-Path $desktopRoot 'release') -Filter 'Yui Install Engine*.exe' -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if (-not $engine) { throw 'electron-builder did not produce the Yui installation engine.' }

$payloadStage = Join-Path $desktopRoot 'build\installer-payload'
New-Item -ItemType Directory -Force -Path $payloadStage | Out-Null
Copy-Item -LiteralPath $engine.FullName -Destination (Join-Path $payloadStage 'Yui Install Engine.exe') -Force
$unpackedApp = Join-Path $desktopRoot 'release\win-unpacked'
if (-not (Test-Path $unpackedApp)) { throw 'The unpacked Yui app is missing; cannot calculate its real installed size.' }
$installedBytes = [long](Get-ChildItem -LiteralPath $unpackedApp -File -Recurse | Measure-Object -Property Length -Sum).Sum
$manifest = [ordered]@{
    name = 'Yui'
    version = (Get-Content (Join-Path $desktopRoot 'package.json') -Raw | ConvertFrom-Json).version
    installedBytes = $installedBytes
    builtAt = (Get-Date).ToUniversalTime().ToString('o')
}
$manifestJson = $manifest | ConvertTo-Json -Compress
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $payloadStage 'installer-manifest.json'), $manifestJson, $utf8WithoutBom)

Invoke-CheckedCommand 'npx.cmd' @('electron-builder', '--config', 'installer-assets/electron-builder-installer.json', '--win', 'portable', '--x64') $desktopRoot
$customInstaller = Get-ChildItem (Join-Path $desktopRoot 'installer-release') -Filter 'Yui Setup*.exe' -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if (-not $customInstaller) { throw 'electron-builder finished without producing the custom Yui Setup app.' }
$releaseRoot = Join-Path $desktopRoot 'release'
New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
$finalInstaller = Join-Path $releaseRoot 'Yui Setup.exe'
Copy-Item -LiteralPath $customInstaller.FullName -Destination $finalInstaller -Force
Write-Host "Custom Windows installer: $finalInstaller"
Write-Host "Installer size: $([math]::Round((Get-Item -LiteralPath $finalInstaller).Length / 1GB, 2)) GB"
