"""Constants for realprice-fast.

涵蓋全台 22 個縣市（含六都 + 直轄市/縣/外島）。
"""
from __future__ import annotations

import os
from pathlib import Path

# 內政部實價登錄 Open Data
MOI_BASE = "https://plvr.land.moi.gov.tw"
MOI_SEASON_URL = f"{MOI_BASE}/DownloadSeason"   # 季資料（公告需等季結束 + 6 週）
MOI_CURRENT_URL = f"{MOI_BASE}/Download"        # 當期滾動旬報（每旬約 1/11/21 更新）

# 全台 22 縣市（變數名仍叫 METRO_CODES 為了相容）
METRO_CODES: dict[str, str] = {
    # 六都
    "a": "臺北市", "f": "新北市", "h": "桃園市",
    "b": "臺中市", "d": "臺南市", "e": "高雄市",
    # 省轄市
    "c": "基隆市", "o": "新竹市", "i": "嘉義市",
    # 縣
    "g": "宜蘭縣", "j": "新竹縣", "k": "苗栗縣",
    "m": "南投縣", "n": "彰化縣", "p": "雲林縣",
    "q": "嘉義縣", "t": "屏東縣", "u": "花蓮縣",
    "v": "臺東縣",
    # 外島
    "w": "金門縣", "x": "澎湖縣", "z": "連江縣",
}

DEAL_KIND = {"a": "sale", "b": "presale", "c": "rent"}
SQM_PER_PING = 3.305785

# 路徑
ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = Path(os.environ.get("REALPRICE_DATA_DIR", ROOT / "data"))
RAW_DIR = DATA_DIR / "raw"          # 下載 ZIP & 解壓 CSV
PARQUET_DIR = DATA_DIR / "parquet"  # 列向欄式儲存
SNAPSHOT_DIR = DATA_DIR / "snapshots"  # 預烘 JSON
WEB_PUBLIC_DIR = ROOT / "web" / "public" / "data"   # 前端 dev 直接讀這裡

for d in (RAW_DIR, PARQUET_DIR, SNAPSHOT_DIR):
    d.mkdir(parents=True, exist_ok=True)
