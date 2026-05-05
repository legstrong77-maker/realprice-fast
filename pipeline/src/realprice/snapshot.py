"""讀 Parquet → 預烘聚合 JSON（給前端直接 fetch 用）。

產出：
  snapshots/meta.json
  snapshots/county-summary.json
  snapshots/heatmap/{cc}-{dk}.json          各縣市鄉鎮的近 12 月中位
  snapshots/momentum/{cc}-{dk}.json          各鄉鎮 6m vs 6~12m 動能
  snapshots/district-monthly/{cc}-{district}-{dk}.json   月度趨勢
  snapshots/distribution/{cc}-{dk}.json      縣市總體價位直方圖（近 12 月）
  snapshots/recent/{cc}-{dk}.json            近 200 筆成交（前端瀏覽 fallback）
"""
from __future__ import annotations

import json
import math
from datetime import date, datetime
from pathlib import Path
from typing import Any

import duckdb
from loguru import logger

from .config import (
    DATA_DIR, DEAL_KIND, METRO_CODES, PARQUET_DIR, SNAPSHOT_DIR, WEB_PUBLIC_DIR,
)


def _json_default(o: Any):
    if isinstance(o, (date, datetime)):
        return o.isoformat()
    if isinstance(o, float) and (math.isnan(o) or math.isinf(o)):
        return None
    raise TypeError(f"can't serialize {type(o)}")


def _clean_nan(obj: Any) -> Any:
    """遞迴把 NaN / Inf 換成 None — 避免 JSON 含 'NaN' 字面值（JS 解析會炸）。"""
    if isinstance(obj, float):
        return None if (math.isnan(obj) or math.isinf(obj)) else obj
    if isinstance(obj, dict):
        return {k: _clean_nan(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean_nan(v) for v in obj]
    return obj


def _write(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    cleaned = _clean_nan(obj)
    path.write_text(
        json.dumps(
            cleaned, ensure_ascii=False, default=_json_default,
            separators=(",", ":"), allow_nan=False,
        ),
        encoding="utf-8",
    )


def _available_deal_kinds() -> list[str]:
    """只回傳真的有 Parquet 檔的 deal_kind。"""
    return sorted({
        p.name.split("-")[0]
        for p in PARQUET_DIR.glob("*.parquet")
    })


def _glob_for(dk: str) -> str:
    return str(PARQUET_DIR / f"{dk}-*.parquet").replace("\\", "/")


def _open() -> duckdb.DuckDBPyConnection:
    con = duckdb.connect()
    con.execute("PRAGMA enable_progress_bar=false")
    available = _available_deal_kinds()
    if not available:
        raise RuntimeError(f"找不到任何 Parquet 檔：{PARQUET_DIR}")
    logger.info(f"[snap] 可用 deal_kind：{available}")
    for dk in available:
        con.execute(f"""
            CREATE OR REPLACE VIEW v_{dk} AS
            SELECT * FROM read_parquet('{_glob_for(dk)}')
        """)
    # 對於不存在的 deal_kind，建空 view（schema 跟 sale 一致），讓查詢不會炸
    for dk in DEAL_KIND.values():
        if dk not in available:
            ref = available[0]
            con.execute(f"""
                CREATE OR REPLACE VIEW v_{dk} AS
                SELECT * FROM v_{ref} WHERE FALSE
            """)
            logger.warning(f"[snap] {dk} 無資料 → 用空 view 代替")
    return con


# 共用過濾
WHERE_CLEAN = """
    is_special_deal = FALSE
    AND unit_price_per_ping IS NOT NULL
    AND unit_price_per_ping BETWEEN 1000 AND 5000000
    AND building_area_sqm >= 20
"""

WHERE_RENT = """
    is_special_deal = FALSE
    AND total_price IS NOT NULL
    AND total_price BETWEEN 1000 AND 2000000
"""


def build_meta(con: duckdb.DuckDBPyConnection, out_dir: Path) -> None:
    counties = [{"code": c, "name": n} for c, n in METRO_CODES.items()]
    districts = {}
    for cc in METRO_CODES:
        rows = con.execute(f"""
            SELECT DISTINCT district FROM v_sale
             WHERE county_code = ? AND district IS NOT NULL AND district <> ''
             ORDER BY district
        """, [cc]).fetchall()
        districts[cc] = [r[0] for r in rows]

    bt_rows = con.execute("""
        SELECT building_type, COUNT(*) AS n FROM v_sale
         WHERE building_type IS NOT NULL AND building_type <> ''
         GROUP BY 1 ORDER BY n DESC
    """).fetchall()

    last_dates = {}
    for dk in DEAL_KIND.values():
        r = con.execute(f"SELECT MAX(deal_date) FROM v_{dk}").fetchone()
        last_dates[dk] = str(r[0]) if r and r[0] else None

    _write(out_dir / "meta.json", {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "counties": counties,
        "districts": districts,
        "building_types": [{"name": r[0], "count": r[1]} for r in bt_rows],
        "last_deal_date": last_dates,
        "deal_kinds": list(DEAL_KIND.values()),
    })
    logger.info("[snap] meta.json")


def build_county_summary(con: duckdb.DuckDBPyConnection, out_dir: Path) -> None:
    out: dict[str, list[dict]] = {}
    for dk in DEAL_KIND.values():
        where = WHERE_RENT if dk == "rent" else WHERE_CLEAN
        rows = con.execute(f"""
            SELECT county_code,
                   COUNT(*) AS total_deals,
                   MAX(deal_date) AS last_deal_date,
                   AVG(unit_price_per_ping) AS avg_unit_price_ping,
                   median(unit_price_per_ping) AS median_unit_price_ping,
                   AVG(total_price) AS avg_total_price,
                   median(total_price) AS median_total_price
              FROM v_{dk}
             WHERE {where}
             GROUP BY county_code
             ORDER BY median_unit_price_ping DESC NULLS LAST
        """).fetchdf().to_dict("records")
        for r in rows:
            r["county_name"] = METRO_CODES.get(r["county_code"], r["county_code"])
            r["last_deal_date"] = str(r["last_deal_date"]) if r["last_deal_date"] else None
        out[dk] = rows
    _write(out_dir / "county-summary.json", out)
    logger.info("[snap] county-summary.json")


def build_heatmap(con: duckdb.DuckDBPyConnection, out_dir: Path, months: int = 12) -> None:
    for cc in METRO_CODES:
        for dk in DEAL_KIND.values():
            where = WHERE_RENT if dk == "rent" else WHERE_CLEAN
            rows = con.execute(f"""
                SELECT district,
                       COUNT(*) AS deals,
                       median(unit_price_per_ping) AS median_unit_price_ping,
                       AVG(unit_price_per_ping) AS avg_unit_price_ping,
                       median(total_price) AS median_total_price
                  FROM v_{dk}
                 WHERE county_code = ?
                   AND {where}
                   AND deal_date >= CURRENT_DATE - INTERVAL '{months} months'
                 GROUP BY district
                 ORDER BY median_unit_price_ping DESC NULLS LAST
            """, [cc]).fetchdf().to_dict("records")
            _write(out_dir / "heatmap" / f"{cc}-{dk}.json", rows)
    logger.info("[snap] heatmap/*")


def build_momentum(con: duckdb.DuckDBPyConnection, out_dir: Path) -> None:
    for cc in METRO_CODES:
        for dk in DEAL_KIND.values():
            where = WHERE_RENT if dk == "rent" else WHERE_CLEAN
            rows = con.execute(f"""
                WITH recent AS (
                    SELECT district, COUNT(*) AS n_now,
                           median(unit_price_per_ping) AS p_now
                      FROM v_{dk}
                     WHERE county_code = ? AND {where}
                       AND deal_date >= CURRENT_DATE - INTERVAL '6 months'
                     GROUP BY district
                ),
                prior AS (
                    SELECT district, COUNT(*) AS n_prev,
                           median(unit_price_per_ping) AS p_prev
                      FROM v_{dk}
                     WHERE county_code = ? AND {where}
                       AND deal_date >= CURRENT_DATE - INTERVAL '12 months'
                       AND deal_date <  CURRENT_DATE - INTERVAL '6 months'
                     GROUP BY district
                )
                SELECT r.district, r.p_now, p.p_prev, r.n_now, p.n_prev,
                       CASE WHEN p.p_prev IS NULL OR p.p_prev = 0 THEN NULL
                            ELSE (r.p_now - p.p_prev) / p.p_prev END AS pct_change
                  FROM recent r LEFT JOIN prior p USING(district)
              ORDER BY pct_change DESC NULLS LAST
            """, [cc, cc]).fetchdf().to_dict("records")
            _write(out_dir / "momentum" / f"{cc}-{dk}.json", rows)
    logger.info("[snap] momentum/*")


def build_district_monthly(con: duckdb.DuckDBPyConnection, out_dir: Path, months: int = 60) -> None:
    """每縣市每鄉鎮 × 每 deal_kind 一個檔，含月度趨勢。"""
    for cc in METRO_CODES:
        districts = con.execute(f"""
            SELECT DISTINCT district FROM v_sale
             WHERE county_code = ? AND district IS NOT NULL AND district <> ''
        """, [cc]).fetchall()
        for (district,) in districts:
            for dk in DEAL_KIND.values():
                where = WHERE_RENT if dk == "rent" else WHERE_CLEAN
                rows = con.execute(f"""
                    SELECT date_trunc('month', deal_date) AS month,
                           COUNT(*) AS deals,
                           median(unit_price_per_ping) AS median_unit_price_ping,
                           AVG(unit_price_per_ping) AS avg_unit_price_ping,
                           median(total_price) AS median_total_price
                      FROM v_{dk}
                     WHERE county_code = ? AND district = ?
                       AND {where}
                       AND deal_date >= CURRENT_DATE - INTERVAL '{months} months'
                     GROUP BY month
                     ORDER BY month
                """, [cc, district]).fetchdf()
                rows["month"] = rows["month"].astype(str).str.slice(0, 10)
                _write(out_dir / "district-monthly" / f"{cc}-{district}-{dk}.json",
                       rows.to_dict("records"))
    logger.info("[snap] district-monthly/*")


def build_distribution(con: duckdb.DuckDBPyConnection, out_dir: Path, months: int = 12) -> None:
    """縣市層級單價直方圖 + 分位數，畫橫向 P25/P50/P75 區間圖。"""
    for cc in METRO_CODES:
        for dk in DEAL_KIND.values():
            where = WHERE_RENT if dk == "rent" else WHERE_CLEAN
            stats = con.execute(f"""
                SELECT COUNT(*) AS n,
                       quantile_cont(unit_price_per_ping, 0.10) AS p10,
                       quantile_cont(unit_price_per_ping, 0.25) AS p25,
                       quantile_cont(unit_price_per_ping, 0.50) AS p50,
                       quantile_cont(unit_price_per_ping, 0.75) AS p75,
                       quantile_cont(unit_price_per_ping, 0.90) AS p90,
                       AVG(unit_price_per_ping) AS mean
                  FROM v_{dk}
                 WHERE county_code = ? AND {where}
                   AND deal_date >= CURRENT_DATE - INTERVAL '{months} months'
            """, [cc]).fetchdf().to_dict("records")[0]

            bins = con.execute(f"""
                SELECT FLOOR(unit_price_per_ping / 100000) AS bin_idx,
                       COUNT(*) AS n
                  FROM v_{dk}
                 WHERE county_code = ? AND {where}
                   AND deal_date >= CURRENT_DATE - INTERVAL '{months} months'
                 GROUP BY 1 ORDER BY 1
            """, [cc]).fetchdf().to_dict("records")
            for b in bins:
                b["lo"] = float(b["bin_idx"]) * 100000
                b["hi"] = b["lo"] + 100000

            _write(out_dir / "distribution" / f"{cc}-{dk}.json", {
                "stats": stats, "bins": bins,
            })
    logger.info("[snap] distribution/*")


def build_building_type(con: duckdb.DuckDBPyConnection, out_dir: Path, months: int = 12) -> None:
    """每縣市 × 各 building_type 的中位/均價/筆數（近 12 月）— 比較公寓 vs 華廈 vs 大樓 vs 透天等。"""
    for cc in METRO_CODES:
        for dk in DEAL_KIND.values():
            where = WHERE_RENT if dk == "rent" else WHERE_CLEAN
            rows = con.execute(f"""
                SELECT building_type,
                       COUNT(*) AS deals,
                       median(unit_price_per_ping) AS median_unit_price_ping,
                       AVG(unit_price_per_ping) AS avg_unit_price_ping,
                       median(total_price) AS median_total_price,
                       AVG(building_area_sqm) AS avg_building_area_sqm,
                       AVG(age_years) AS avg_age_years
                  FROM v_{dk}
                 WHERE county_code = ?
                   AND {where}
                   AND building_type IS NOT NULL AND building_type <> ''
                   AND deal_date >= CURRENT_DATE - INTERVAL '{months} months'
                 GROUP BY building_type
                HAVING COUNT(*) >= 5
                 ORDER BY deals DESC
            """, [cc]).fetchdf().to_dict("records")
            _write(out_dir / "building-type" / f"{cc}-{dk}.json", rows)
    logger.info("[snap] building-type/*")


def build_age_buckets(con: duckdb.DuckDBPyConnection, out_dir: Path, months: int = 12) -> None:
    """屋齡分箱 vs 中位單價 — 看屋齡對價格的影響。"""
    for cc in METRO_CODES:
        rows = con.execute(f"""
            WITH bucketed AS (
                SELECT CASE
                    WHEN age_years IS NULL THEN '未知'
                    WHEN age_years < 5 THEN '0-5 年'
                    WHEN age_years < 10 THEN '5-10 年'
                    WHEN age_years < 20 THEN '10-20 年'
                    WHEN age_years < 30 THEN '20-30 年'
                    WHEN age_years < 40 THEN '30-40 年'
                    ELSE '40 年以上' END AS bucket,
                    unit_price_per_ping, total_price, building_area_sqm
                  FROM v_sale
                 WHERE county_code = ?
                   AND {WHERE_CLEAN}
                   AND deal_date >= CURRENT_DATE - INTERVAL '{months} months'
            )
            SELECT bucket,
                   COUNT(*) AS deals,
                   median(unit_price_per_ping) AS median_unit_price_ping,
                   median(total_price) AS median_total_price,
                   AVG(building_area_sqm) AS avg_building_area_sqm
              FROM bucketed
             WHERE bucket <> '未知'
             GROUP BY bucket
             ORDER BY CASE bucket
                WHEN '0-5 年' THEN 1
                WHEN '5-10 年' THEN 2
                WHEN '10-20 年' THEN 3
                WHEN '20-30 年' THEN 4
                WHEN '30-40 年' THEN 5
                WHEN '40 年以上' THEN 6 END
        """, [cc]).fetchdf().to_dict("records")
        _write(out_dir / "age-buckets" / f"{cc}.json", rows)
    logger.info("[snap] age-buckets/*")


def build_size_buckets(con: duckdb.DuckDBPyConnection, out_dir: Path, months: int = 12) -> None:
    """坪數分箱 vs 中位總價 — 看「多大坪數要花多少錢」最直觀。"""
    for cc in METRO_CODES:
        rows = con.execute(f"""
            WITH bucketed AS (
                SELECT CASE
                    WHEN building_area_sqm < 33.05 THEN '~10 坪'
                    WHEN building_area_sqm < 66.10 THEN '10-20 坪'
                    WHEN building_area_sqm < 99.16 THEN '20-30 坪'
                    WHEN building_area_sqm < 132.21 THEN '30-40 坪'
                    WHEN building_area_sqm < 165.26 THEN '40-50 坪'
                    WHEN building_area_sqm < 231.37 THEN '50-70 坪'
                    ELSE '70 坪以上' END AS bucket,
                    unit_price_per_ping, total_price, age_years
                  FROM v_sale
                 WHERE county_code = ?
                   AND {WHERE_CLEAN}
                   AND deal_date >= CURRENT_DATE - INTERVAL '{months} months'
            )
            SELECT bucket,
                   COUNT(*) AS deals,
                   median(unit_price_per_ping) AS median_unit_price_ping,
                   median(total_price) AS median_total_price,
                   AVG(age_years) AS avg_age_years
              FROM bucketed
             GROUP BY bucket
             ORDER BY CASE bucket
                WHEN '~10 坪' THEN 1
                WHEN '10-20 坪' THEN 2
                WHEN '20-30 坪' THEN 3
                WHEN '30-40 坪' THEN 4
                WHEN '40-50 坪' THEN 5
                WHEN '50-70 坪' THEN 6
                WHEN '70 坪以上' THEN 7 END
        """, [cc]).fetchdf().to_dict("records")
        _write(out_dir / "size-buckets" / f"{cc}.json", rows)
    logger.info("[snap] size-buckets/*")


def build_roads(con: duckdb.DuckDBPyConnection, out_dir: Path, months: int = 24) -> None:
    """每縣市 × deal_kind 的 road-level 聚合，附上 geocode_cache 中的 lat/lng。
    沒 lat/lng 的路段也會出現在輸出（前端 fallback 顯示在區中心）。
    """
    cache_path = DATA_DIR / "geocode_cache.json"
    cache = {}
    if cache_path.exists():
        try:
            cache = json.loads(cache_path.read_text(encoding="utf-8"))
        except Exception:
            logger.warning("geocode_cache.json 解析失敗")

    for cc in METRO_CODES:
        for dk in DEAL_KIND.values():
            where = WHERE_RENT if dk == "rent" else WHERE_CLEAN
            rows = con.execute(f"""
                SELECT district, road,
                       COUNT(*) AS deals,
                       median(unit_price_per_ping) AS median_unit_price_ping,
                       AVG(unit_price_per_ping) AS avg_unit_price_ping,
                       median(total_price) AS median_total_price,
                       MAX(deal_date) AS last_deal_date
                  FROM v_{dk}
                 WHERE county_code = ?
                   AND road IS NOT NULL AND road <> ''
                   AND {where}
                   AND deal_date >= CURRENT_DATE - INTERVAL '{months} months'
                 GROUP BY district, road
                HAVING COUNT(*) >= 3
                 ORDER BY deals DESC
                 LIMIT 800
            """, [cc]).fetchdf().to_dict("records")
            # 附 lat/lng
            for r in rows:
                key = f"{cc}|{r['road']}"
                hit = cache.get(key) or {}
                r["lat"] = hit.get("lat")
                r["lng"] = hit.get("lng")
                r["last_deal_date"] = str(r["last_deal_date"]) if r.get("last_deal_date") else None
            _write(out_dir / "roads" / f"{cc}-{dk}.json", rows)
    logger.info("[snap] roads/*")


def build_recent(con: duckdb.DuckDBPyConnection, out_dir: Path, limit: int = 2000) -> None:
    """每縣市 × deal_kind 近 N 筆成交（瀏覽頁起步資料）。"""
    for cc in METRO_CODES:
        for dk in DEAL_KIND.values():
            where = WHERE_RENT if dk == "rent" else WHERE_CLEAN
            rows = con.execute(f"""
                SELECT serial_no, county_code, district, address, building_type,
                       total_floors, transfer_floor_num, age_years,
                       rooms, halls, baths,
                       building_area_sqm, total_price, unit_price_per_ping,
                       deal_date
                  FROM v_{dk}
                 WHERE county_code = ? AND {where}
                 ORDER BY deal_date DESC
                 LIMIT {limit}
            """, [cc]).fetchdf()
            rows["deal_date"] = rows["deal_date"].astype(str)
            _write(out_dir / "recent" / f"{cc}-{dk}.json", rows.to_dict("records"))
    logger.info("[snap] recent/*")


def build_all_snapshots(out_dir: Path = SNAPSHOT_DIR) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    con = _open()
    try:
        build_meta(con, out_dir)
        build_county_summary(con, out_dir)
        build_heatmap(con, out_dir)
        build_momentum(con, out_dir)
        build_district_monthly(con, out_dir)
        build_distribution(con, out_dir)
        build_building_type(con, out_dir)
        build_age_buckets(con, out_dir)
        build_size_buckets(con, out_dir)
        build_roads(con, out_dir)
        build_recent(con, out_dir)
    finally:
        con.close()


def sync_to_web_public() -> None:
    """把 snapshots/ 複製到 web/public/data/，dev 直接讀同源 JSON。"""
    import shutil
    if WEB_PUBLIC_DIR.exists():
        shutil.rmtree(WEB_PUBLIC_DIR)
    shutil.copytree(SNAPSHOT_DIR, WEB_PUBLIC_DIR)
    logger.info(f"[sync] {SNAPSHOT_DIR} → {WEB_PUBLIC_DIR}")
