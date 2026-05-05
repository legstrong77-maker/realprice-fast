"""Geocode 個別地址（門牌級） → (lat, lng) via OSM Nominatim.

跟 geocode.py（路段級）的差別：
  - 輸入是 web/public/data/recent/*.json 裡的個別地址字串
  - 全形數字 → 半形（Nominatim 對「１２０號」命中率極差）
  - 結果寫入 data/addr_geocode_cache.json（獨立於路段 cache）
  - 命中失敗會記成 not_found，重跑不再試（除非手動清掉）
"""
from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Iterable

import httpx
from loguru import logger

from .config import DATA_DIR, METRO_CODES, ROOT

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = os.environ.get(
    "REALPRICE_USER_AGENT",
    "realprice-fast/0.1 (Taiwan real-price aggregator; please set REALPRICE_USER_AGENT)",
)
ADDR_CACHE_PATH = DATA_DIR / "addr_geocode_cache.json"
RATE_LIMIT_SEC = 1.05
INSECURE_TLS = os.environ.get("REALPRICE_INSECURE_TLS", "").lower() in ("1", "true", "yes")
RECENT_DIR = ROOT / "web" / "public" / "data" / "recent"


# 全形 → 半形 (含數字、英文字母、空白)
_FW_TABLE = str.maketrans(
    "０１２３４５６７８９ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ"
    "ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ　",
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    "abcdefghijklmnopqrstuvwxyz ",
)


def normalize_addr(addr: str) -> str:
    s = addr.translate(_FW_TABLE)
    # 把樓層、之X 砍掉 — Nominatim 不認得「XX號X樓之X」這種台灣編號慣例
    s = re.sub(r"(\d+)號.*$", r"\1號", s)
    # 巷弄保留，但統一空白
    s = re.sub(r"\s+", "", s)
    return s


def load_addr_cache() -> dict[str, dict]:
    if ADDR_CACHE_PATH.exists():
        try:
            return json.loads(ADDR_CACHE_PATH.read_text(encoding="utf-8"))
        except Exception:
            logger.warning("addr_geocode_cache.json 解析失敗，使用空 cache")
    return {}


def save_addr_cache(cache: dict) -> None:
    ADDR_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    ADDR_CACHE_PATH.write_text(
        json.dumps(cache, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def collect_addresses() -> list[tuple[str, str, str]]:
    """掃 web/public/data/recent/*.json，回 [(cc, deal_kind, address_normalized), ...] (去重)."""
    seen: set[tuple[str, str, str]] = set()
    out: list[tuple[str, str, str]] = []
    if not RECENT_DIR.exists():
        logger.error(f"找不到 {RECENT_DIR}，先跑 snapshot + sync-web")
        return out
    for fp in sorted(RECENT_DIR.glob("*.json")):
        # 檔名格式：{cc}-{dk}.json
        name = fp.stem  # e.g. d-sale
        if "-" not in name:
            continue
        cc, dk = name.split("-", 1)
        try:
            rows = json.loads(fp.read_text(encoding="utf-8"))
        except Exception:
            continue
        for r in rows:
            addr = r.get("address")
            if not addr:
                continue
            norm = normalize_addr(addr)
            key = (cc, dk, norm)
            if key in seen:
                continue
            seen.add(key)
            out.append(key)
    return out


def _query(addr: str, county_name: str, client: httpx.Client) -> dict | None:
    # Nominatim 對台灣門牌命中率不高，採漸進式 fallback：
    #   1. 完整地址（含縣市）—— 鬧區較大型街可能 hit
    #   2. 砍到「巷N」級別 —— 命中率最高的甜蜜點
    #   3. 不 fallback 到路段，因為路段已由 geocode_cache 處理過
    full = addr if addr.startswith(("臺", "台")) else f"{county_name}{addr}"

    # 抽巷級：保留到第一個「巷」之前 + 巷N
    lane_match = re.search(r"^(.*?(?:路|街|大道|段))(\d+巷)?", full)
    if lane_match:
        lane_q = lane_match.group(0)
        if not lane_q.endswith("巷"):
            # 沒巷的地址，就用到路段為止 + 號（讓 Nominatim 試完整版）
            lane_q = full
    else:
        lane_q = full

    queries = [full]
    if lane_q != full:
        queries.append(lane_q)

    seen = set()
    for q in queries:
        if q in seen:
            continue
        seen.add(q)
        params = {"q": q, "format": "json", "limit": 1, "addressdetails": 0, "countrycodes": "tw"}
        try:
            r = client.get(NOMINATIM_URL, params=params, timeout=20)
            r.raise_for_status()
            results = r.json()
            if results:
                return {
                    "lat": float(results[0]["lat"]),
                    "lng": float(results[0]["lon"]),
                    "query": q,
                }
        except Exception as e:
            logger.warning(f"Nominatim {q!r}: {e}")
        time.sleep(RATE_LIMIT_SEC)
    return None


def geocode_addresses(
    candidates: Iterable[tuple[str, str, str]],
    max_count: int | None = None,
    only_with_road_cache: bool = False,
) -> dict:
    """跑 geocoding。若 only_with_road_cache=True，會限制只查路段已 cached 過的地址。"""
    cache = load_addr_cache()

    road_cache: dict[str, dict] = {}
    if only_with_road_cache:
        rc_path = DATA_DIR / "geocode_cache.json"
        if rc_path.exists():
            try:
                road_cache = json.loads(rc_path.read_text(encoding="utf-8"))
            except Exception:
                pass

    todo: list[tuple[str, str, str]] = []
    for cc, dk, addr in candidates:
        key = f"{cc}|{addr}"
        if key in cache and (cache[key].get("lat") or cache[key].get("not_found")):
            continue
        if only_with_road_cache:
            # 從地址抽路段名 — 路段 cache 的 key 形式是「{cc}|{district}{road}」，
            # 所以要先把「臺X市 / X縣 / X市」前綴砍掉，剩下「{district}{road}...」
            stripped = re.sub(r"^(臺[北中南]市|[新桃高基][^縣市]*市|.*?縣|.*?市)", "", addr)
            m = re.match(r"^(.*?(?:路|街|巷|弄|大道|段))", stripped)
            if not m:
                continue
            road = m.group(1)
            rk = f"{cc}|{road}"
            if rk not in road_cache or not road_cache[rk].get("lat"):
                continue
        todo.append((cc, dk, addr))

    if max_count:
        todo = todo[:max_count]

    if not todo:
        logger.info("addr-geocode: 沒有新地址要查")
        return cache

    eta_min = len(todo) * RATE_LIMIT_SEC * 1.5 / 60  # *1.5 因為我們可能會 fallback 第二查
    logger.info(f"addr-geocode: {len(todo)} 個新地址要查（預計 {eta_min:.1f} 分鐘）")

    headers = {"User-Agent": USER_AGENT, "Accept-Language": "zh-Hant,zh;q=0.9,en;q=0.5"}
    found = 0
    with httpx.Client(headers=headers, follow_redirects=True, verify=not INSECURE_TLS) as client:
        for i, (cc, dk, addr) in enumerate(todo, 1):
            key = f"{cc}|{addr}"
            county_name = METRO_CODES.get(cc, "")
            t0 = time.monotonic()
            res = _query(addr, county_name, client)
            if res:
                cache[key] = {**res, "ts": int(time.time())}
                found += 1
            else:
                cache[key] = {"not_found": True, "ts": int(time.time())}
            if i % 25 == 0 or i == len(todo):
                hit_rate = found / i * 100
                logger.info(f"  [{i}/{len(todo)}] hit={found} ({hit_rate:.0f}%) — last: {addr}")
                save_addr_cache(cache)
            elapsed = time.monotonic() - t0
            if elapsed < RATE_LIMIT_SEC:
                time.sleep(RATE_LIMIT_SEC - elapsed)

    save_addr_cache(cache)
    logger.info(f"addr-geocode 完成：cache={len(cache)}, hit={found}/{len(todo)}")
    return cache


def apply_cache_to_recent_files(use_osm: bool = True) -> None:
    """把 lat/lng 寫回 recent/*.json。

    優先順序：
      1. addr_geocode_cache.json（Nominatim 跑出來的精準對）
      2. OSM 本地庫（osm_addr.lookup_with_road_fallback）— 只在 use_osm=True 時開
    """
    cache = load_addr_cache()
    osm_lookup = None
    if use_osm:
        try:
            from . import osm_addr
            if osm_addr._get_con() is not None:
                osm_lookup = osm_addr.lookup_with_road_fallback
                logger.info("OSM 本地庫已就緒，未命中 cache 的會 fallback 查 OSM")
            else:
                logger.warning("OSM 本地庫不存在，跳過 OSM fallback（先跑 osm-build）")
        except Exception as e:
            logger.warning(f"OSM 本地庫載入失敗：{e}")

    updated_files = 0
    total_cache = total_osm = 0
    osm_levels = {"exact": 0, "lane": 0, "road": 0}
    for fp in sorted(RECENT_DIR.glob("*.json")):
        name = fp.stem
        if "-" not in name:
            continue
        cc, _ = name.split("-", 1)
        try:
            rows = json.loads(fp.read_text(encoding="utf-8"))
        except Exception:
            continue
        attached_c = attached_o = 0
        for r in rows:
            addr = r.get("address")
            if not addr:
                continue
            norm = normalize_addr(addr)
            key = f"{cc}|{norm}"
            entry = cache.get(key)
            if entry and entry.get("lat"):
                r["lat"] = entry["lat"]
                r["lng"] = entry["lng"]
                r["geocode_src"] = "nominatim"
                attached_c += 1
                continue
            if osm_lookup is None:
                continue
            res = osm_lookup(addr)
            if res:
                r["lat"], r["lng"], lvl = res
                r["geocode_src"] = f"osm:{lvl}"
                attached_o += 1
                osm_levels[lvl] = osm_levels.get(lvl, 0) + 1
        if attached_c + attached_o > 0:
            fp.write_text(
                json.dumps(rows, ensure_ascii=False, separators=(",", ":")),
                encoding="utf-8",
            )
            updated_files += 1
            total_cache += attached_c
            total_osm += attached_o
            logger.info(
                f"  {fp.name}: cache={attached_c}, osm={attached_o}"
            )
    logger.info(
        f"完成：更新 {updated_files} 個檔，cache={total_cache:,}, osm={total_osm:,} "
        f"（osm levels: {osm_levels}）"
    )
