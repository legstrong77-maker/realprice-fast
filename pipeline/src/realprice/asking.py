"""Phase 2：抓售屋平台「開價」→ 聚合成『每區開價中位』（抓完即丟個別物件）。

只保留每個鄉鎮區的彙總數字（中位 萬/坪、樣本數），不存任何單一物件 ——
法律上發布的是統計而非他人物件清單，且符合本站「做統計不做 listing」的定位。

來源：
  幸福家 singfujia.com   —— Next.js，__NEXT_DATA__ 內含 Laravel 分頁 JSON（乾淨、台南為主）
  住商   hbhousing.com.tw —— Nuxt3，__NUXT_DATA__ SSR payload 解析（price/area/doorplate）。
        注意：SSR 只渲染前 ~10 筆/縣市（分頁參數無效），全列表靠捲動 XHR（host 未定位）。
        故住商目前為全國各縣市各 ~10 筆的薄樣本，多數區達不到 MIN_N、由議價率推估補。

輸出：data/asking/{cc}.json  = list[{district, asking_median_ping, n, p25, p75, source}]
      （asking_median_ping 單位為元/坪，與實價登錄 heatmap 對齊；由 spread.py 自動取用）

備註：開價雜訊大（掛太高、面議、土地車位、一物多刊），故：
  - 過濾面議 / 土地 / 0 坪 / 單價超出合理範圍
  - 同址同價去重（減少一物多刊）
  - 取中位、每區至少 MIN_N 筆才出數（不足由 spread.py 退回議價率推估）
"""
from __future__ import annotations

import json
import re
import time
from pathlib import Path
from statistics import median, quantiles

import httpx
from loguru import logger

from .config import DATA_DIR, METRO_CODES, SQM_PER_PING

ASKING_DIR = DATA_DIR / "asking"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
HEADERS = {"User-Agent": UA, "Accept-Language": "zh-TW,zh;q=0.9"}

# 每縣市最多抓幾頁（每頁約 20 筆）——區域中位不需全量，取樣本即穩定。會 log 實際抓到幾筆。
MAX_PAGES = 40
REQ_DELAY = 0.8          # 禮貌性延遲（秒）
MIN_N = 5               # 每區最少幾筆才出數
# 單價合理範圍（元/坪）——沿用站內品質規則精神
UNIT_MIN, UNIT_MAX = 1000, 5_000_000

# 中文縣市名 → cc（含 台/臺 正規化）
_NAME2CC = {}
for _cc, _name in METRO_CODES.items():
    _NAME2CC[_name] = _cc
    _NAME2CC[_name.replace("臺", "台")] = _cc


def _norm_county(raw: str) -> str | None:
    return _NAME2CC.get(raw) or _NAME2CC.get(raw.replace("台", "臺"))


def _split_addr(addr: str) -> tuple[str | None, str | None]:
    """'台南市安南區本田街三段' → ('d', '安南區')。"""
    if not addr:
        return None, None
    m = re.match(r"^\s*(.{2,3}?[縣市])(.+)$", addr)
    if not m:
        return None, None
    cc = _norm_county(m.group(1))
    dm = re.match(r"^(.+?[區鄉鎮市])", m.group(2))
    district = dm.group(1) if dm else None
    return cc, district


def _agg(buckets: dict[tuple[str, str], list[float]], source: str) -> dict[str, list[dict]]:
    """{(cc,district): [unit_ping,...]} → {cc: [row,...]}（取中位/分位、過 MIN_N）。"""
    out: dict[str, list[dict]] = {}
    for (cc, district), vals in buckets.items():
        if len(vals) < MIN_N:
            continue
        q = quantiles(vals, n=4) if len(vals) >= 4 else [None, median(vals), None]
        out.setdefault(cc, []).append({
            "district": district,
            "asking_median_ping": round(median(vals)),
            "n": len(vals),
            "p25": round(q[0]) if q[0] else None,
            "p75": round(q[2]) if q[2] else None,
            "source": source,
        })
    return out


# ──────────────────────────── 幸福家 ────────────────────────────
def fetch_singfujia(max_pages: int = MAX_PAGES) -> dict[tuple[str, str], list[float]]:
    """抓幸福家買屋清單（不帶 city 參數，逐筆解析地址自動歸區；台南覆蓋最佳）。"""
    buckets: dict[tuple[str, str], list[float]] = {}
    seen: set[tuple] = set()
    n_raw = n_used = 0
    with httpx.Client(timeout=25, follow_redirects=True, headers=HEADERS) as cli:
        for page in range(1, max_pages + 1):
            try:
                r = cli.get(f"https://singfujia.com/buy?page={page}")
                m = re.search(r'__NEXT_DATA__" type="application/json">(.*?)</script>', r.text, re.S)
                if not m:
                    break
                lst = json.loads(m.group(1))["props"]["pageProps"]["listAPI"]["list"]
                rows = lst.get("data") or []
            except Exception as e:
                logger.warning(f"[asking] 幸福家 page {page} 失敗：{e}")
                break
            if not rows:
                break
            for s in rows:
                n_raw += 1
                if s.get("p_price_hide") or s.get("is_na"):
                    continue
                price_wan = s.get("co_price")          # 開價（萬）
                ping = s.get("t_floor")                # 建坪
                if not price_wan or not ping or ping <= 0:
                    continue
                # 土地（land_class_id 2 在此站為大樓住宅 → 不過濾；只用坪數/單價防呆）
                unit_ping = price_wan * 10_000 / ping  # 元/坪
                if not (UNIT_MIN <= unit_ping <= UNIT_MAX):
                    continue
                cc, district = _split_addr(s.get("outer_address") or "")
                if not cc or not district:
                    continue
                key = (s.get("case_serial"), price_wan)
                if key in seen:
                    continue
                seen.add(key)
                buckets.setdefault((cc, district), []).append(unit_ping)
                n_used += 1
            if page >= (lst.get("last_page") or page):
                break
            time.sleep(REQ_DELAY)
    logger.info(f"[asking] 幸福家：原始 {n_raw} 筆 → 採用 {n_used} 筆，{len(buckets)} 個區")
    return buckets


# ──────────────────────────── 住商 ────────────────────────────
def _parse_hb_payload(html: str) -> list[dict]:
    """從住商買屋頁的 Nuxt3 __NUXT_DATA__ payload 解出清單物件。

    payload 是 devalue 格式（扁平陣列 + 索引參照）：物件的每個欄位值是陣列索引。
    清單物件帶 price(開價萬) / area(建坪) / doorplate(區+路) / type(型態) 等。
    """
    m = re.search(r'id="__NUXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    if not m:
        return []
    try:
        arr = json.loads(m.group(1))
    except Exception:
        return []

    def deref(idx):
        return arr[idx] if isinstance(idx, int) and 0 <= idx < len(arr) else None

    out = []
    for d in arr:
        if isinstance(d, dict) and "price" in d and "area" in d and "doorplate" in d:
            out.append({
                "price": deref(d["price"]),
                "area": deref(d["area"]),
                "doorplate": deref(d["doorplate"]),
                "type": deref(d.get("type", -1)),
            })
    return out


def fetch_hbhousing(max_pages: int = MAX_PAGES) -> dict[tuple[str, str], list[float]]:
    """抓住商各縣市買屋清單（全國覆蓋）。

    資料來自伺服器端渲染的 Nuxt3 __NUXT_DATA__ payload（非 XHR、非卡片 HTML）。
    每頁約 10–20 筆，分頁參數 ?p=N。抓完即聚合即丟個別物件。
    """
    buckets: dict[tuple[str, str], list[float]] = {}
    seen: set[tuple] = set()
    n_used = 0
    with httpx.Client(timeout=25, follow_redirects=True, headers=HEADERS) as cli:
        for cc, name in METRO_CODES.items():
            cnt = 0
            for page in range(1, max_pages + 1):
                url = f"https://www.hbhousing.com.tw/buyhouse/{name}" + (f"?p={page}" if page > 1 else "")
                try:
                    r = cli.get(url)
                    if r.status_code != 200:
                        break
                except Exception as e:
                    logger.warning(f"[asking] 住商 {name} p{page} 失敗：{e}")
                    break
                items = _parse_hb_payload(r.text)
                if not items:
                    break
                page_new = 0
                for it in items:
                    price_wan, area = it["price"], it["area"]
                    doorplate = it["doorplate"] or ""
                    try:
                        price_wan = float(price_wan)
                        area = float(area)
                    except (TypeError, ValueError):
                        continue
                    if price_wan <= 0 or area <= 0:        # 面議 / 土地 / 缺值
                        continue
                    dm = re.match(r"(.+?[區鄉鎮市])", doorplate)
                    district = dm.group(1) if dm else None
                    if not district:
                        continue
                    unit_ping = price_wan * 10_000 / area
                    if not (UNIT_MIN <= unit_ping <= UNIT_MAX):
                        continue
                    key = (cc, district, round(price_wan), round(area, 1))
                    if key in seen:
                        continue
                    seen.add(key)
                    buckets.setdefault((cc, district), []).append(unit_ping)
                    cnt += 1
                    page_new += 1
                    n_used += 1
                if page_new == 0:                          # 整頁都重複 → 已到底
                    break
                time.sleep(REQ_DELAY)
            if cnt:
                logger.info(f"[asking] 住商 {name}：{cnt} 筆")
    logger.info(f"[asking] 住商：採用 {n_used} 筆，{len(buckets)} 個區")
    return buckets


def _merge(*bucket_dicts: dict[tuple[str, str], list[float]]) -> dict[tuple[str, str], list[float]]:
    merged: dict[tuple[str, str], list[float]] = {}
    for bd in bucket_dicts:
        for k, vals in bd.items():
            merged.setdefault(k, []).extend(vals)
    return merged


def build_asking(sources: tuple[str, ...] = ("singfujia",),
                 max_pages: int = MAX_PAGES) -> None:
    """抓開價 → 聚合 → 寫 data/asking/{cc}.json。之後跑 `realprice spread` 即生效。"""
    parts = []
    src_labels = []
    if "singfujia" in sources:
        parts.append(fetch_singfujia(max_pages))
        src_labels.append("幸福家")
    if "hbhousing" in sources:
        parts.append(fetch_hbhousing(max_pages))
        src_labels.append("住商")
    merged = _merge(*parts)
    source_label = "+".join(src_labels) + " 開價聚合"
    by_cc = _agg(merged, source_label)

    ASKING_DIR.mkdir(parents=True, exist_ok=True)
    total_districts = 0
    for cc in METRO_CODES:
        rows = sorted(by_cc.get(cc, []), key=lambda r: -r["n"])
        (ASKING_DIR / f"{cc}.json").write_text(
            json.dumps(rows, ensure_ascii=False, separators=(",", ":")), encoding="utf-8",
        )
        total_districts += len(rows)
    logger.info(f"[asking] 完成：{total_districts} 個區有開價中位 → {ASKING_DIR}")
    logger.info("[asking] 下一步：python -m realprice spread（重算議價空間）→ sync-web")
