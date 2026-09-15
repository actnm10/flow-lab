$ErrorActionPreference = 'Stop'
$flowNode = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $flowNode) {
    $flowBundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    if (Test-Path -LiteralPath $flowBundledNode) { $flowNode = $flowBundledNode }
}
if (-not $flowNode) { Write-Host 'Install Node.js, then run this launcher again.'; Read-Host 'Press Enter'; exit 1 }
$flowServer = Join-Path $PSScriptRoot 'server.cjs'
$flowReady = $false
try { $flowStatus = Invoke-RestMethod 'http://127.0.0.1:8766/api/status' -TimeoutSec 2; $flowReady = $null -ne $flowStatus.blender } catch {}
if (-not $flowReady) {
    Start-Process -FilePath $flowNode -ArgumentList @(('"' + $flowServer + '"')) -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
    for ($flowAttempt=0; $flowAttempt -lt 30; $flowAttempt++) {
        Start-Sleep -Milliseconds 200
        try { $flowStatus = Invoke-RestMethod 'http://127.0.0.1:8766/api/status' -TimeoutSec 1; $flowReady=$true; break } catch {}
    }
}
if ($flowReady) { Start-Process 'http://127.0.0.1:8766' }
else { Write-Host 'Flow Lab could not start. Run node server.cjs to see details.'; Read-Host 'Press Enter' }

