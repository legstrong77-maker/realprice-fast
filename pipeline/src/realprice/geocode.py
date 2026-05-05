"""Geocode 路段 → (lat, lng)，用 OSM Nominatim。

Nominatim 公開服務規範：
  - 必須有 User-Agent
  - rate-limit 1 req/s
  - 不可用於大量批量

我們的策略：
  - 只 geocode「路段」（不是個別地址，符合 MOI 隱私精神）
  - 結果寫入 data/geocode_cache.json，永久 cache
  - 重跑只查未快取的部分
  - 加上鄉鎮 + 縣市 prefix 提升命中率
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path

import httpx
from loguru import logger

from .config import DATA_DIR, METRO_CODES

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "realprice-fast/0.1 (https://github.com/legstrong77-maker; contact: legstrong77@gmail.com)"
CACHE_PATH = DATA_DIR / "geocode_cache.json"
RATE_LIMIT_SEC = 1.05  # 守住 1 req/s 規範
INSECURE_TLS = os.environ.get("REALPRICE_INSECURE_TLS", "").lower() in ("1", "true", "yes")


def load_cache() -> dict[str, dict]:
    if CACHE_PATH.exists():
        try:
            return json.loads(CACHE_PATH.read_text(encoding="utf-8"))
        except Exception:
            logger.warning("geocode_cache.json 解析失敗，使用空 cache")
    return {}


def save_cache(cache: dict) -> None:
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(
        json.dumps(cache, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _query_nominatim(query: str, client: httpx.Client) -> dict | None:
    params = {"q": query, "format": "json", "limit": 1, "addressdetails": 0, "countrycodes": "tw"}
    try:
        r = client.get(NOMINATIM_URL, params=params, timeout=20)
        r.raise_for_status()
        results = r.json()
        if results:
            return {"lat": float(results[0]["lat"]), "lng": float(results[0]["lon"])}
    except Exception as e:
        logger.warning(f"Nominatim {query!r}: {e}")
    return None


def geocode_roads(roads: list[tuple[str, str]], max_count: int | None = None) -> dict[str, dict]:
    """roads = [(county_code, road), ...]
    回傳更新後的 cache（同時寫回 disk）。
    """
    cache = load_cache()
    todo = []
    for cc, road in roads:
        key = f"{cc}|{road}"
        if key in cache and cache[key].get("lat"):
            continue  # 已有
        if key in cache and cache[key].get("not_found"):
            continue  # 之前查過確定查不到，不再試
        todo.append((cc, road, key))

    if max_count:
        todo = todo[:max_count]

    if not todo:
        logger.info("geocode: 沒有新的路段要查")
        return cache

    logger.info(f"geocode: {len(todo)} 個新路段要查（每秒 1 個，預計 {len(todo) * RATE_LIMIT_SEC / 60:.1f} 分鐘）")

    headers = {"User-Agent": USER_AGENT, "Accept-Language": "zh-Hant,zh;q=0.9,en;q=0.5"}
    with httpx.Client(headers=headers, follow_redirects=True, verify=not INSECURE_TLS) as client:
        for i, (cc, road, key) in enumerate(todo, 1):
            county_name = METRO_CODES.get(cc, "")
            # Nominatim 對台灣中文街道名命中率：加上「縣市」幫助
            query = f"{county_name}{road}"
            t0 = time.monotonic()
            res = _query_nominatim(query, client)
            if res:
                cache[key] = {**res, "query": query, "ts": int(time.time())}
                if i % 10 == 0 or i == len(todo):
                    logger.info(f"  [{i}/{len(todo)}] {road} → ({res['lat']:.4f}, {res['lng']:.4f})")
            else:
                cache[key] = {"not_found": True, "query": query, "ts": int(time.time())}
            # 每 50 筆寫一次（中斷也不會全丟）
            if i % 50 == 0:
                save_cache(cache)
            elapsed = time.monotonic() - t0
            if elapsed < RATE_LIMIT_SEC:
                time.sleep(RATE_LIMIT_SEC - elapsed)

    save_cache(cache)
    logger.info(f"geocode 完成，cache 大小：{len(cache)}")
    return cache
