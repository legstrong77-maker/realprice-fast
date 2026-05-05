"""從 OpenStreetMap Overpass API 抓 POI（捷運站、學校、嫌惡設施）。

設計：
  - 一次抓全台、寫成靜態 JSON
  - 因 Overpass 是公開服務，加重試 + 鏡像
  - 每類 POI 一個檔，由前端按需 toggle 顯示
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

import httpx
from loguru import logger

from .config import SNAPSHOT_DIR

INSECURE_TLS = os.environ.get("REALPRICE_INSECURE_TLS", "").lower() in ("1", "true", "yes")

OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.fr/api/interpreter",
]

POI_DIR = SNAPSHOT_DIR / "poi"

# Overpass QL queries
QUERIES = {
    # 鐵道站：高鐵、台鐵、捷運、輕軌
    "stations": """
        [out:json][timeout:90];
        area["ISO3166-1"="TW"][admin_level=2]->.tw;
        (
          node["railway"="station"](area.tw);
          node["railway"="halt"](area.tw);
          node["station"="subway"](area.tw);
          node["station"="light_rail"](area.tw);
          node["public_transport"="station"]["train"="yes"](area.tw);
        );
        out body;
    """,
    # 學校：國小、國中、高中、大專
    "schools": """
        [out:json][timeout:90];
        area["ISO3166-1"="TW"][admin_level=2]->.tw;
        (
          node["amenity"="school"](area.tw);
          way["amenity"="school"](area.tw);
          node["amenity"="university"](area.tw);
          way["amenity"="university"](area.tw);
          node["amenity"="college"](area.tw);
          way["amenity"="college"](area.tw);
        );
        out center;
    """,
    # 嫌惡設施：殯儀館、公墓、加油站、變電所、垃圾掩埋、監獄
    "nimby": """
        [out:json][timeout:120];
        area["ISO3166-1"="TW"][admin_level=2]->.tw;
        (
          node["amenity"="funeral_hall"](area.tw);
          way["amenity"="funeral_hall"](area.tw);
          node["amenity"="crematorium"](area.tw);
          way["amenity"="crematorium"](area.tw);
          node["landuse"="cemetery"](area.tw);
          way["landuse"="cemetery"](area.tw);
          node["amenity"="fuel"](area.tw);
          node["power"="substation"](area.tw);
          way["power"="substation"](area.tw);
          node["amenity"="prison"](area.tw);
          way["amenity"="prison"](area.tw);
          node["landuse"="landfill"](area.tw);
          way["landuse"="landfill"](area.tw);
        );
        out center;
    """,
}


def _fetch(query: str) -> dict:
    """嘗試多個 Overpass mirror，遇到 429/503 退避重試。"""
    last_err: Exception | None = None
    for url in OVERPASS_URLS:
        for attempt in range(3):
            try:
                with httpx.Client(timeout=180.0, verify=not INSECURE_TLS) as client:
                    logger.info(f"  POST {url} (attempt {attempt+1})")
                    r = client.post(url, content=query.encode("utf-8"))
                    if r.status_code == 200:
                        return r.json()
                    if r.status_code in (429, 503, 504):
                        wait = 10 * (attempt + 1)
                        logger.warning(f"  {r.status_code}, retry in {wait}s")
                        time.sleep(wait)
                        continue
                    r.raise_for_status()
            except Exception as e:
                last_err = e
                logger.warning(f"  {url} → {e}")
                time.sleep(5)
                break
    raise RuntimeError(f"Overpass 全失敗：{last_err}")


def _normalize(elements: list[dict], kind: str) -> list[dict[str, Any]]:
    """把 Overpass 回傳統一成 [{name, lat, lng, subtype, county_hint}] 格式。"""
    out: list[dict] = []
    for e in elements:
        lat = e.get("lat") or e.get("center", {}).get("lat")
        lng = e.get("lon") or e.get("center", {}).get("lon")
        if lat is None or lng is None:
            continue
        tags = e.get("tags") or {}
        name = (tags.get("name:zh-Hant") or tags.get("name:zh")
                or tags.get("name") or tags.get("name:en"))
        if not name:
            continue
        # 細分類
        subtype = None
        if kind == "stations":
            station = tags.get("station")
            railway = tags.get("railway")
            if station == "subway":   subtype = "捷運"
            elif station == "light_rail": subtype = "輕軌"
            elif railway == "station" and tags.get("train") == "yes": subtype = "台鐵"
            elif railway == "station" and tags.get("operator", "").startswith("台灣高速"): subtype = "高鐵"
            elif railway == "station": subtype = "車站"
            else: subtype = "車站"
            # 進一步：高鐵
            op = tags.get("operator", "") + tags.get("operator:zh", "")
            if "高鐵" in op or "THSR" in op or "Taiwan High Speed" in op.lower():
                subtype = "高鐵"
            elif "捷運" in op or "Metro" in op or "MRT" in op:
                subtype = "捷運"
        elif kind == "schools":
            amenity = tags.get("amenity")
            if amenity == "school":
                # 嘗試從名稱判斷階段
                if "高中" in name or "高商" in name or "高工" in name or "高職" in name:
                    subtype = "高中職"
                elif "國中" in name:
                    subtype = "國中"
                elif "國小" in name or "小學" in name:
                    subtype = "國小"
                else:
                    subtype = "中小學"
            elif amenity == "university":
                subtype = "大學"
            elif amenity == "college":
                subtype = "學院"
            else:
                subtype = "學校"
        elif kind == "nimby":
            amenity = tags.get("amenity")
            landuse = tags.get("landuse")
            power = tags.get("power")
            if amenity == "funeral_hall":   subtype = "殯儀館"
            elif amenity == "crematorium":  subtype = "火葬場"
            elif amenity == "fuel":         subtype = "加油站"
            elif amenity == "prison":       subtype = "監獄"
            elif power == "substation":     subtype = "變電所"
            elif landuse == "cemetery":     subtype = "公墓"
            elif landuse == "landfill":     subtype = "掩埋場"
        out.append({
            "name": name,
            "lat": float(lat),
            "lng": float(lng),
            "subtype": subtype or "其他",
        })
    return out


def build_pois() -> dict[str, int]:
    POI_DIR.mkdir(parents=True, exist_ok=True)
    counts: dict[str, int] = {}
    for kind, query in QUERIES.items():
        logger.info(f"[poi] {kind}")
        try:
            result = _fetch(query)
        except Exception as e:
            logger.error(f"[poi] {kind} 失敗：{e}")
            continue
        data = _normalize(result.get("elements", []), kind)
        out_file = POI_DIR / f"{kind}.json"
        out_file.write_text(
            json.dumps(data, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        counts[kind] = len(data)
        logger.info(f"[poi] {kind}: {len(data)} 個 → {out_file.name}")
    return counts
