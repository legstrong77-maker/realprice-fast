"""把所有季的 CSV 解析後、依 county × deal_kind 寫成 Parquet。

資料佈局：
  data/parquet/sale-a.parquet   (臺北市買賣)
  data/parquet/sale-f.parquet   (新北市買賣)
  data/parquet/presale-a.parquet
  data/parquet/rent-a.parquet
  ...
"""
from __future__ import annotations

import re
from pathlib import Path

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
from loguru import logger

from .config import DEAL_KIND, METRO_CODES, PARQUET_DIR, RAW_DIR
from .download import download_current, download_season, extract
from .parse import discover_files, parse_csv

# 要保留的欄位順序（同時當作 Schema）
COLUMNS = [
    "serial_no", "deal_kind", "county_code", "county_name", "district",
    "address", "road",
    "land_area_sqm", "building_area_sqm", "parking_area_sqm",
    "transfer_floor", "transfer_floor_num", "total_floors",
    "building_type", "main_use", "main_material",
    "build_completion", "age_years",
    "rooms", "halls", "baths",
    "has_partition", "has_management",
    "deal_date", "total_price", "unit_price_per_sqm", "unit_price_per_ping",
    "parking_kind", "parking_price",
    "note", "is_special_deal", "source_season",
]


def collect_records_for_seasons(seasons: list[str], include_current: bool = True) -> list[dict]:
    """下載 + 解壓 + 解析所有季的六都 CSV，一次回傳所有 record。

    include_current=True 會額外抓「當期滾動旬報」(`/Download` 端點，含尚未發布的當季最新成交)。
    """
    all_records: list[dict] = []
    for season in seasons:
        try:
            zp = download_season(season)
        except Exception as e:
            logger.warning(f"[skip] {season} 下載失敗：{e}")
            continue
        ed = extract(zp)
        files = discover_files(ed)
        logger.info(f"[parse] {season} → {len(files)} 個六都 CSV")
        for f in files:
            n = 0
            for rec in parse_csv(f, source_season=season):
                all_records.append(rec)
                n += 1
            logger.info(f"  {f.name}: {n:,} 筆")

    if include_current:
        try:
            zp = download_current()
            ed = extract(zp)
            files = discover_files(ed)
            logger.info(f"[parse] CURRENT 旬報 → {len(files)} 個六都 CSV")
            for f in files:
                n = 0
                for rec in parse_csv(f, source_season="CURRENT"):
                    all_records.append(rec)
                    n += 1
                logger.info(f"  {f.name}: {n:,} 筆 (current)")
        except Exception as e:
            logger.warning(f"[skip] 當期旬報抓取失敗：{e}")

    return all_records


def build_parquet(records: list[dict], out_dir: Path = PARQUET_DIR) -> dict[str, Path]:
    """依 deal_kind × county_code 切檔 Parquet。"""
    out_dir.mkdir(parents=True, exist_ok=True)
    if not records:
        logger.warning("沒有資料可寫")
        return {}

    df = pd.DataFrame(records, columns=COLUMNS)
    df["deal_date"] = pd.to_datetime(df["deal_date"], errors="coerce").dt.date
    df["build_completion"] = pd.to_datetime(df["build_completion"], errors="coerce").dt.date

    # 跨季 + serial 去重，同 (serial_no, deal_kind) 留最新一筆
    df = df.sort_values("source_season").drop_duplicates(
        subset=["serial_no", "deal_kind"], keep="last"
    )

    written: dict[str, Path] = {}
    for cc in METRO_CODES:
        for dk_short, dk in DEAL_KIND.items():
            sub = df[(df["county_code"] == cc) & (df["deal_kind"] == dk)]
            if sub.empty:
                continue
            out = out_dir / f"{dk}-{cc}.parquet"
            tbl = pa.Table.from_pandas(sub, preserve_index=False)
            pq.write_table(tbl, out, compression="zstd")
            written[f"{dk}-{cc}"] = out
            logger.info(f"[parquet] {dk}-{cc}: {len(sub):,} 筆 → {out.relative_to(out_dir.parent)}")

    return written
