# 一鍵跑：下載 + 烘 Parquet + 烘 JSON + 同步到 web
# 用法： .\run-pipeline.ps1 [-Since 113] [-Insecure]
param(
    [int]$Since = 113,
    [switch]$Insecure
)

$ErrorActionPreference = "Stop"

Push-Location $PSScriptRoot\pipeline
try {
    $env:PYTHONPATH = "src"
    if ($Insecure) {
        $env:REALPRICE_INSECURE_TLS = "1"
        Write-Host "[!] TLS verify disabled for MOI endpoint" -ForegroundColor Yellow
    }
    Write-Host ">>> realprice all --since $Since" -ForegroundColor Cyan
    python -m realprice all --since $Since
}
finally {
    Pop-Location
}

Write-Host "`n[done] 接著:  cd web ; npm run dev" -ForegroundColor Green
