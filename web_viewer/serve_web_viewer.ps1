param(
    [int]$Port = 8080
)

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$listener = New-Object System.Net.HttpListener
$prefix = "http://localhost:$Port/"

function Get-ContentType([string]$path) {
    switch ([System.IO.Path]::GetExtension($path).ToLowerInvariant()) {
        ".html" { return "text/html; charset=utf-8" }
        ".js" { return "application/javascript; charset=utf-8" }
        ".json" { return "application/json; charset=utf-8" }
        ".css" { return "text/css; charset=utf-8" }
        ".png" { return "image/png" }
        ".jpg" { return "image/jpeg" }
        ".jpeg" { return "image/jpeg" }
        ".gif" { return "image/gif" }
        ".svg" { return "image/svg+xml" }
        ".gltf" { return "model/gltf+json" }
        ".glb" { return "model/gltf-binary" }
        ".bin" { return "application/octet-stream" }
        ".txt" { return "text/plain; charset=utf-8" }
        ".md" { return "text/markdown; charset=utf-8" }
        default { return "application/octet-stream" }
    }
}

function Resolve-RequestPath([string]$urlPath) {
    $relative = [System.Uri]::UnescapeDataString($urlPath.TrimStart("/")).Replace("/", "\")
    if ([string]::IsNullOrWhiteSpace($relative)) {
        $relative = "web_viewer\index.html"
    }

    $candidate = Join-Path $projectRoot $relative
    if ((Test-Path $candidate -PathType Container)) {
        $candidate = Join-Path $candidate "index.html"
    }

    return $candidate
}

$listener.Prefixes.Add($prefix)
$listener.Start()

Write-Host ""
Write-Host "Web viewer attivo su $prefix" -ForegroundColor Cyan
Write-Host "Apri: $prefix" -ForegroundColor Yellow
Write-Host "Root servita: $projectRoot" -ForegroundColor DarkGray
Write-Host "Premi Ctrl+C per fermare il server." -ForegroundColor DarkGray
Write-Host ""

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $requestPath = Resolve-RequestPath $context.Request.Url.AbsolutePath

        if (-not (Test-Path $requestPath -PathType Leaf)) {
            $context.Response.StatusCode = 404
            $buffer = [System.Text.Encoding]::UTF8.GetBytes("404 - File non trovato")
            $context.Response.ContentType = "text/plain; charset=utf-8"
            $context.Response.OutputStream.Write($buffer, 0, $buffer.Length)
            $context.Response.Close()
            continue
        }

        $bytes = [System.IO.File]::ReadAllBytes($requestPath)
        $context.Response.StatusCode = 200
        $context.Response.ContentType = Get-ContentType $requestPath
        $context.Response.ContentLength64 = $bytes.Length
        $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $context.Response.Close()
    }
}
finally {
    if ($listener.IsListening) {
        $listener.Stop()
    }
    $listener.Close()
}
