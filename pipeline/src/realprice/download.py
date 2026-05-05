"""下載內政部實價登錄 Open Data ZIP。

備註：內政部 plvr.land.moi.gov.tw 的 SSL 憑證偶爾會出現
"Missing Subject Key Identifier" 之類的舊憑證問題。
若在你的環境碰到 cert 驗證失敗，可設環境變數
  REALPRICE_INSECURE_TLS=1
讓 httpx 跳過驗證（公開資料、非機密，但仍是顯式 opt-in）。
"""
from __future__ import annotations

import os
import zipfile
from datetime import date
from pathlib import Path

import httpx
from loguru import logger
from tenacity import retry, stop_after_attempt, wait_exponential

from .config import MOI_CURRENT_URL, MOI_SEASON_URL, RAW_DIR

INSECURE_TLS = os.environ.get("REALPRICE_INSECURE_TLS", "").lower() in ("1", "true", "yes")


def latest_season(today: date | None = None) -> str:
    """回傳目前『一定下載得到』的最新季代號（季結束後 6 週才公告，保守抓上一季）。"""
    today = today or date.today()
    roc = today.year - 1911
    q = (today.month - 1) // 3 + 1
    q -= 1
    if q <= 0:
        q = 4
        roc -= 1
    return f"{roc}S{q}"


def all_seasons_since(start_year_roc: int = 110) -> list[str]:
    latest = latest_season()
    ly = int(latest.split("S")[0])
    lq = int(latest.split("S")[1])
    out: list[str] = []
    for y in range(start_year_roc, ly + 1):
        for q in (1, 2, 3, 4):
            if y == ly and q > lq:
                break
            out.append(f"{y}S{q}")
    return out


@retry(stop=stop_after_attempt(4), wait=wait_exponential(min=2, max=30))
def download_season(season: str, dest_dir: Path | None = None) -> Path:
    dest_dir = dest_dir or RAW_DIR
    dest_dir.mkdir(parents=True, exist_ok=True)
    out = dest_dir / f"lvr_{season}.zip"

    if out.exists() and out.stat().st_size > 1024:
        logger.info(f"[skip] {season} 已存在")
        return out

    params = {"season": season, "type": "zip", "fileName": "lvr_landcsv.zip"}
    logger.info(f"[get ] {season}{' (TLS verify disabled)' if INSECURE_TLS else ''}")
    with httpx.Client(timeout=180.0, follow_redirects=True, verify=not INSECURE_TLS) as client:
        r = client.get(MOI_SEASON_URL, params=params)
        r.raise_for_status()
        if not r.content or r.content[:2] != b"PK":
            raise RuntimeError(f"{season} 回傳非 ZIP 內容（{len(r.content)} bytes）— 該季可能尚未公告")
        out.write_bytes(r.content)
    logger.info(f"[ok  ] {season} → {out.stat().st_size:,} bytes")
    return out


def extract(zip_path: Path) -> Path:
    extract_dir = zip_path.with_suffix("")
    extract_dir.mkdir(exist_ok=True)
    with zipfile.ZipFile(zip_path, "r") as z:
        z.extractall(extract_dir)
    return extract_dir


@retry(stop=stop_after_attempt(4), wait=wait_exponential(min=2, max=30))
def download_current(dest_dir: Path | None = None) -> Path:
    """下載當期滾動旬報（含當季尚未公告但已部分更新的最新成交）。

    每月 1 / 11 / 21 日更新一次。回傳 zip 路徑，**每次都重新下載**（旬報滾動）。
    """
    dest_dir = dest_dir or RAW_DIR
    dest_dir.mkdir(parents=True, exist_ok=True)
    out = dest_dir / f"lvr_current_{date.today().isoformat()}.zip"

    if out.exists() and out.stat().st_size > 1024:
        logger.info("[skip] 今日已抓過旬報")
        return out

    params = {"type": "zip", "fileName": "lvr_landcsv.zip"}
    logger.info(f"[get ] 旬報{' (TLS verify disabled)' if INSECURE_TLS else ''}")
    with httpx.Client(timeout=180.0, follow_redirects=True, verify=not INSECURE_TLS) as client:
        r = client.get(MOI_CURRENT_URL, params=params)
        r.raise_for_status()
        if not r.content or r.content[:2] != b"PK":
            raise RuntimeError(f"旬報回傳非 ZIP（{len(r.content)} bytes）")
        out.write_bytes(r.content)
    logger.info(f"[ok  ] 旬報 → {out.stat().st_size:,} bytes")
    return out
