# 刷新「議價空間」的開價資料：抓售屋平台開價 → 重算 spread →（可選）推上 git 觸發 Cloudflare 部署。
# 開價變動慢，每週刷新一次即可（議價率報告是每季，改 config/nego_rate.json 後另跑 `python -m realprice spread`）。
#
# 用法：
#   .\refresh-asking.ps1            # 抓開價 + 重算議價空間（本機 web/public/data，dev 直接看）
#   .\refresh-asking.ps1 -Push      # 再 git commit + push（Cloudflare 自動重新部署）
#   .\refresh-asking.ps1 -Register  # 註冊「每週一 09:00 自動執行（含 -Push）」的 Windows 排程
#   .\refresh-asking.ps1 -Unregister # 移除排程
param(
    [switch]$Push,
    [switch]$Register,
    [switch]$Unregister,
    [int]$MaxPages = 0    # 0 = 沿用 asking.py 的 MAX_PAGES 常數（目前 400，抓到 last_page 才得真實在架量）
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$taskName = "Realprice Asking Refresh"

if ($Unregister) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "[ok] 已移除排程「$taskName」" -ForegroundColor Green
    return
}

if ($Register) {
    $ps = (Get-Command powershell).Source
    $self = Join-Path $root "refresh-asking.ps1"
    $action  = New-ScheduledTaskAction -Execute $ps `
        -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$self`" -Push"
    $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 9:00am
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Force `
        -Description "每週抓售屋平台開價，重算議價空間並 push 到 Cloudflare" | Out-Null
    Write-Host "[ok] 已註冊排程「$taskName」：每週一 09:00 自動刷新並 push" -ForegroundColor Green
    Write-Host "    查看：Get-ScheduledTask -TaskName '$taskName' | Get-ScheduledTaskInfo" -ForegroundColor DarkGray
    return
}

# ── 1) 抓開價 + 重算 spread（asking 指令內部會自動 build_spread 到 web/public/data）
Push-Location (Join-Path $root "pipeline")
try {
    $env:PYTHONPATH = "src"
    if ($MaxPages -gt 0) {
        Write-Host ">>> realprice asking --max-pages $MaxPages" -ForegroundColor Cyan
        python -m realprice asking --max-pages $MaxPages
    } else {
        Write-Host ">>> realprice asking（使用預設 MAX_PAGES，抓到 last_page）" -ForegroundColor Cyan
        python -m realprice asking
    }
}
finally { Pop-Location }

# ── 2) 可選：推上 git（Cloudflare 連動部署）
if ($Push) {
    Push-Location $root
    try {
        git add web/public/data/spread web/public/data/spread-summary.json `
                web/public/data/spread-trend web/public/data/asking-history `
                data/asking data/asking-history
        $stamp = Get-Date -Format "yyyy-MM-dd"
        # 沒有變更時 git commit 會非 0 結束；包起來避免中斷排程
        git commit -m "data: refresh 議價空間 + 開價歷史 ($stamp)" 2>$null
        if ($LASTEXITCODE -eq 0) {
            git push
            Write-Host "[ok] 已 push，Cloudflare 將自動部署" -ForegroundColor Green
        } else {
            Write-Host "[skip] 開價無變更，未產生 commit" -ForegroundColor DarkGray
        }
    }
    finally { Pop-Location }
}

Write-Host "`n[done] 議價空間已更新。本機看：cd web ; npm run dev → /spread" -ForegroundColor Green
