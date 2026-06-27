param(
    [string]$OutputName = "procedural_horror_offline_viewer.zip"
)

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$staging = Join-Path $root "web_viewer_export"
$zipPath = Join-Path $root $OutputName

if (Test-Path $staging) {
    Remove-Item -LiteralPath $staging -Recurse -Force
}

New-Item -ItemType Directory -Path $staging | Out-Null
New-Item -ItemType Directory -Path (Join-Path $staging "renders") | Out-Null

Copy-Item -LiteralPath (Join-Path $PSScriptRoot "index.html") -Destination $staging
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "viewer.js") -Destination $staging
Copy-Item -Path (Join-Path $PSScriptRoot "renders\*") -Destination (Join-Path $staging "renders") -Recurse

$launcher = @'
@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
start "" "%SCRIPT_DIR%index.html"
endlocal
'@
Set-Content -LiteralPath (Join-Path $staging "open_viewer.cmd") -Value $launcher -Encoding ASCII

if (Test-Path $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}

Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $zipPath
Write-Host "Export creato: $zipPath"
