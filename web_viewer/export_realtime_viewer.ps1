param(
    [string]$OutputName = "procedural_horror_realtime_viewer.zip"
)

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$staging = Join-Path $root "web_viewer_realtime_export"
$zipPath = Join-Path $root $OutputName

if (Test-Path $staging) {
    Remove-Item -LiteralPath $staging -Recurse -Force
}

New-Item -ItemType Directory -Path $staging | Out-Null
New-Item -ItemType Directory -Path (Join-Path $staging "web_viewer") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $staging "Scene_Exports") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $staging "node_modules") | Out-Null

Copy-Item -LiteralPath (Join-Path $root "start_web_viewer.cmd") -Destination $staging
Copy-Item -LiteralPath (Join-Path $root "index.html") -Destination $staging
Copy-Item -LiteralPath (Join-Path $root "package.json") -Destination $staging
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "index.html") -Destination (Join-Path $staging "web_viewer")
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "viewer.js") -Destination (Join-Path $staging "web_viewer")
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "server.cjs") -Destination (Join-Path $staging "web_viewer")
Copy-Item -LiteralPath (Join-Path $root "Scene_Exports\scene_entities.json") -Destination (Join-Path $staging "Scene_Exports")

Copy-Item -LiteralPath (Join-Path $root "node_modules\three") -Destination (Join-Path $staging "node_modules") -Recurse
Copy-Item -LiteralPath (Join-Path $root "realistic_vending_machine__3d_model") -Destination $staging -Recurse
Copy-Item -LiteralPath (Join-Path $root "wheel_chair") -Destination $staging -Recurse
Copy-Item -LiteralPath (Join-Path $root "chair") -Destination $staging -Recurse
Copy-Item -LiteralPath (Join-Path $root "chair (1)") -Destination $staging -Recurse
Copy-Item -LiteralPath (Join-Path $root "worn_steel_door") -Destination $staging -Recurse
Copy-Item -LiteralPath (Join-Path $root "animated_injured_zombie_crawling_loop") -Destination $staging -Recurse
Copy-Item -LiteralPath (Join-Path $root "Hollow Framework.mp3") -Destination $staging

$readme = @'
# Procedural Horror Corridor Realtime Viewer

Avvio rapido:

1. Esegui `start_web_viewer.cmd`
2. Si aprira un server locale su `http://localhost:8080/web_viewer/index.html`
3. Nel browser premi `Carica E Avvia`

Controlli:

- Click su `Entra Nel Corridoio`
- `W A S D` per muoverti
- `Shift` per sprint
- `F` per torcia
- `M` per musica
- `Esc` per liberare il cursore

Questa build e completamente offline a runtime.
'@
Set-Content -LiteralPath (Join-Path $staging "README.txt") -Value $readme -Encoding ASCII

if (Test-Path $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}

Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $zipPath
Write-Host "Export creato: $zipPath"
