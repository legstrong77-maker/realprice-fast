"""議價空間（開價 vs 成交）預烘。

回答業務/開發最關心的一句：「這區現在開價開多少？成交又是多少？砍價空間多大？」

兩種方法，每列標清楚用哪種：
  方法 B（report）：用各縣市公布的「議價率」回推開價
        開價中位 = 成交中位 / (1 - 議價率)；議價空間 = 議價率。
        顆粒度為縣市級（同縣市各區共用一個議價率）。
  方法 A（scrape）：用實抓的「該區開價中位」直接和你的成交中位比
        議價空間 = (開價中位 - 成交中位) / 開價中位。顆粒度為區級。
        Phase 2 上線後，scraper 會把每區開價中位寫到 data/asking/{cc}.json，
        本模組偵測到、且該區樣本足夠（n >= MIN_ASKING_N）時，自動以方法 A 覆蓋方法 B。

產出（沿用預烘 JSON 模式，前端純 fetch）：
  snapshots/spread-summary.json        全台 22 縣市一覽（國家級排行用）
  snapshots/spread/{cc}.json           各縣市鄉鎮的開價/成交/議價空間

不抓、不存任何個別物件 —— 只保留「每區一個彙總數字」。
"""
from __future__ import annotations

import json
from pathlib import Path

from loguru import logger

from .config import DATA_DIR, METRO_CODES, ROOT, SNAPSHOT_DIR
from .snapshot import _write

# config/nego_rate.json：每季手動更新的議價率（人唯一要碰的地方）
NEGO_RATE_PATH = ROOT / "config" / "nego_rate.json"
# Phase 2 scraper 的輸出（可選）：每縣市一檔，list[{district, asking_median_ping, n, ...}]
ASKING_DIR = DATA_DIR / "asking"
# 方法 A 需要的最小開價樣本數，不足就退回方法 B（議價率回推）
MIN_ASKING_N = 5


def _load_nego_rate() -> dict:
    if not NEGO_RATE_PATH.exists():
        logger.warning(f"[spread] 找不到 {NEGO_RATE_PATH}，全部用 default 0.14")
        return {"default": {"rate": 0.14, "period": "?", "source": "fallback"}, "counties": {}}
    return json.loads(NEGO_RATE_PATH.read_text(encoding="utf-8"))


def _county_rate(nego: dict, cc: str) -> dict:
    """回傳該縣市的議價率設定 {rate, period, source}，缺則用 default。"""
    d = (nego.get("counties") or {}).get(cc)
    if d and isinstance(d.get("rate"), (int, float)):
        return d
    return nego.get("default") or {"rate": 0.14, "period": "?", "source": "fallback"}


def _load_asking(cc: str) -> dict[str, dict]:
    """讀 Phase 2 scraper 的開價聚合（若有）。回傳 {district: {asking_median_ping, n}}。"""
    p = ASKING_DIR / f"{cc}.json"
    if not p.exists():
        return {}
    try:
        rows = json.loads(p.read_text(encoding="utf-8"))
        out: dict[str, dict] = {}
        for r in rows:
            d = r.get("district")
            if d:
                out[d] = r
        return out
    except Exception as e:
        logger.warning(f"[spread] 解析 {p} 失敗：{e}")
        return {}


def _read_snapshot_json(out_dir: Path, rel: str):
    p = out_dir / rel
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def _row_for(district: str, sold_ping: float | None, sold_deals: int,
             rate_cfg: dict, asking_hit: dict | None) -> dict:
    """組一個區的議價空間列。優先方法 A（實抓），否則方法 B（議價率回推）。"""
    rate = float(rate_cfg.get("rate") or 0.14)

    # 方法 A：實抓開價中位（樣本足夠才用）
    if asking_hit:
        a_ping = asking_hit.get("asking_median_ping")
        a_n = asking_hit.get("n") or 0
        if a_ping and a_n >= MIN_ASKING_N and sold_ping:
            spread = (a_ping - sold_ping) / a_ping if a_ping > 0 else None
            return {
                "district": district,
                "sold_median_ping": sold_ping,
                "sold_deals": sold_deals,
                "asking_median_ping": a_ping,
                "asking_n": a_n,
                "nego_rate": spread,            # 實測議價空間
                "spread_pct": spread,
                "method": "scrape",
                "source": asking_hit.get("source") or "實抓開價聚合",
            }

    # 方法 B：議價率回推開價
    asking = (sold_ping / (1 - rate)) if (sold_ping and rate < 1) else None
    return {
        "district": district,
        "sold_median_ping": sold_ping,
        "sold_deals": sold_deals,
        "asking_median_ping": asking,
        "asking_n": None,
        "nego_rate": rate,
        "spread_pct": rate,                     # 方法 B：議價空間 == 議價率
        "method": "report",
        "source": rate_cfg.get("source") or "議價率報告",
    }


def build_spread(out_dir: Path = SNAPSHOT_DIR) -> None:
    """產出 spread-summary.json + spread/{cc}.json。需先跑過 build_heatmap / build_county_summary。"""
    nego = _load_nego_rate()

    # ── 各縣市鄉鎮明細
    for cc in METRO_CODES:
        heat = _read_snapshot_json(out_dir, f"heatmap/{cc}-sale.json")
        if heat is None:
            logger.warning(f"[spread] 缺 heatmap/{cc}-sale.json，跳過 {cc}")
            continue
        rate_cfg = _county_rate(nego, cc)
        asking = _load_asking(cc)
        rows = [
            _row_for(
                h["district"], h.get("median_unit_price_ping"), h.get("deals") or 0,
                rate_cfg, asking.get(h["district"]),
            )
            for h in heat
            if h.get("district")
        ]
        # 砍價空間大→小排序（談判機會大的在前）
        rows.sort(key=lambda r: (r["spread_pct"] is None, -(r["spread_pct"] or 0)))
        _write(out_dir / "spread" / f"{cc}.json", rows)

    # ── 全台縣市一覽（國家級排行）：用 county-summary 的成交中位 × 議價率
    summary = _read_snapshot_json(out_dir, "county-summary.json") or {}
    sale_rows = summary.get("sale") or []
    nat = []
    for s in sale_rows:
        cc = s.get("county_code")
        sold = s.get("median_unit_price_ping")
        rate_cfg = _county_rate(nego, cc)
        rate = float(rate_cfg.get("rate") or 0.14)
        asking = (sold / (1 - rate)) if (sold and rate < 1) else None
        nat.append({
            "county_code": cc,
            "county_name": METRO_CODES.get(cc, cc),
            "sold_median_ping": sold,
            "asking_median_ping": asking,
            "nego_rate": rate,
            "spread_pct": rate,
            "total_deals": s.get("total_deals"),
            "period": rate_cfg.get("period"),
            "source": rate_cfg.get("source"),
        })
    nat.sort(key=lambda r: (r["spread_pct"] is None, -(r["spread_pct"] or 0)))
    _write(out_dir / "spread-summary.json", nat)
    logger.info(f"[spread] spread-summary.json + spread/* ({len(nat)} 縣市)")
