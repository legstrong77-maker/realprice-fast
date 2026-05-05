"""解析內政部實價登錄 CSV，產出標準化過的 dict 串流。

檔名規則：
  [縣市代碼]_lvr_land_a.csv  → 不動產買賣
  [縣市代碼]_lvr_land_b.csv  → 預售屋買賣
  [縣市代碼]_lvr_land_c.csv  → 不動產租賃

第一列英文欄名為主，第二列中文說明要跳過。
"""
from __future__ import annotations

import re
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Iterator

import pandas as pd
from loguru import logger

from .config import DEAL_KIND, METRO_CODES, SQM_PER_PING

CN_NUM = {
    "零": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
    "六": 6, "七": 7, "八": 8, "九": 9, "十": 10,
    "壹": 1, "貳": 2, "參": 3, "肆": 4, "伍": 5,
    "陸": 6, "柒": 7, "捌": 8, "玖": 9, "拾": 10,
}

SPECIAL_KEYWORDS = ("親友", "員工", "債務", "瑕疵", "凶宅", "受贈", "急售", "急讓", "受迫", "特殊")

# 全形→半形阿拉伯數字
_FW_DIGITS = str.maketrans("０１２３４５６７８９", "0123456789")

# 中文段位 (X路N段) 的擷取
# 縣市前綴可為「XX市」或「XX縣」
# 子行政區可為「XX區」(直轄市/省轄市)、「XX市」(縣轄市，例：竹北市)、「XX鎮」(例：埔里鎮)、「XX鄉」(例：名間鄉)
# 區名涵蓋 1~3 字（東區、信義區、烏日區、鼓山區）
_ROAD_RE = re.compile(
    r"^(?:[一-鿿]{2,3}(?:市|縣))?"
    r"([一-鿿]{1,3}(?:區|市|鎮|鄉))?"
    r"([一-鿿]+?(?:路|街|大道))"
    r"(?:\s*([一二三四五六七八九十]+段))?"
)


def extract_road(address: str | None, district: str | None = None) -> str | None:
    """從地址抽出『路段』，例：
        '臺北市信義區基隆路一段３號' → '信義區基隆路一段'
        '臺北市文山區指南路三段１４巷１' → '文山區指南路三段'
        '臺北市萬華區萬大路１３７巷' → '萬華區萬大路'
        '青年段一小段400-1地號' → None（土地，無街道）
    回傳 '<district><road><段>'（地圖 geocode 用）。
    """
    if not address:
        return None
    s = address.translate(_FW_DIGITS).strip()
    # 純土地、地號 — 沒有街道
    if "地號" in s or ("段" in s and ("路" not in s and "街" not in s and "大道" not in s)):
        return None
    m = _ROAD_RE.match(s)
    if not m:
        return None
    d, road, sec = m.group(1), m.group(2), m.group(3) or ""
    if not d and district:
        d = district
    if not d:
        return None
    return f"{d}{road}{sec}"


def discover_files(extract_dir: Path) -> list[Path]:
    """找到六都的 *_lvr_land_[abc].csv。其他縣市直接忽略。"""
    out: list[Path] = []
    pat = re.compile(r"^([a-z])_lvr_land_([abc])\.csv$", re.IGNORECASE)
    for p in extract_dir.rglob("*_lvr_land_*.csv"):
        m = pat.match(p.name)
        if not m:
            continue
        cc = m.group(1).lower()
        if cc not in METRO_CODES:
            continue
        out.append(p)
    return sorted(out)


def parse_roc_date(s: Any, *, allow_future: bool = False) -> date | None:
    if s is None or pd.isna(s):
        return None
    s = str(s).strip()
    if not s:
        return None
    s = s.rjust(7, "0")
    try:
        roc = int(s[:-4])
        m = int(s[-4:-2])
        d = int(s[-2:])
        if roc <= 0 or not 1 <= m <= 12 or not 1 <= d <= 31:
            return None
        dt = date(roc + 1911, m, d)
    except (ValueError, TypeError):
        return None
    # 拒絕明顯不合理的未來日期 — MOI 偶有把交易日打錯成未來的雜訊單
    if not allow_future and dt > date.today():
        return None
    return dt


def parse_int(v: Any) -> int | None:
    if v is None or pd.isna(v):
        return None
    try:
        return int(Decimal(str(v).strip()))
    except (InvalidOperation, ValueError):
        return None


def _smallint(n: int | None) -> int | None:
    if n is None or not (-32768 <= n <= 32767):
        return None
    return n


def parse_dec(v: Any) -> Decimal | None:
    if v is None or pd.isna(v):
        return None
    try:
        return Decimal(str(v).strip())
    except (InvalidOperation, ValueError):
        return None


def parse_floor(s: Any) -> int | None:
    if s is None or pd.isna(s):
        return None
    txt = str(s).strip()
    if not txt:
        return None
    m = re.search(r"(\d+)", txt)
    if m:
        n = int(m.group(1))
        return -n if "地下" in txt else n
    sign = -1 if "地下" in txt else 1
    txt = txt.replace("地下", "").replace("層", "")
    if not txt:
        return None
    if "十" in txt:
        a, _, b = txt.partition("十")
        tens = CN_NUM.get(a, 1) if a else 1
        ones = CN_NUM.get(b, 0) if b else 0
        return sign * (tens * 10 + ones)
    if txt in CN_NUM:
        return sign * CN_NUM[txt]
    return None


def parse_yes(s: Any) -> bool | None:
    if s is None or pd.isna(s):
        return None
    t = str(s).strip()
    if t == "有":
        return True
    if t == "無":
        return False
    return None


def detect_special_deal(note: str | None) -> bool:
    if not note:
        return False
    return any(k in note for k in SPECIAL_KEYWORDS)


def parse_csv(path: Path, source_season: str) -> Iterator[dict]:
    """逐筆 yield 標準化好的 dict。"""
    m = re.match(r"^([a-z])_lvr_land_([abc])\.csv$", path.name, re.IGNORECASE)
    if not m:
        return
    county_code = m.group(1).lower()
    deal_kind = DEAL_KIND[m.group(2).lower()]
    if county_code not in METRO_CODES:
        return

    try:
        df = pd.read_csv(
            path, dtype=str, keep_default_na=False, encoding="utf-8",
            low_memory=False, on_bad_lines="skip",
        )
    except UnicodeDecodeError:
        df = pd.read_csv(
            path, dtype=str, keep_default_na=False, encoding="utf-8-sig",
            low_memory=False, on_bad_lines="skip",
        )

    if len(df) == 0:
        return

    # 第二列是中文欄名說明
    first_row = " ".join(str(v) for v in df.iloc[0].values)
    if any(k in first_row for k in ("區段位置", "鄉鎮", "交易標的", "土地位置")):
        df = df.iloc[1:].reset_index(drop=True)

    cols = {c.strip(): c for c in df.columns}

    def col(*candidates: str) -> str | None:
        for c in candidates:
            if c in cols:
                return cols[c]
        return None

    # 同時兼容買賣 (sale)、預售 (presale)、租賃 (rent) 三種欄名變體
    c_district  = col("The villages and towns urban district", "鄉鎮市區")
    c_addr      = col("The road or street, lane and alley",
                      "land sector position building sector house number plate",
                      "土地位置建物門牌")
    # 租賃 = 「土地面積平方公尺」、買賣 = 「土地移轉總面積平方公尺」
    c_land_area = col("land shifting total area square meter",
                      "土地移轉總面積平方公尺", "土地面積平方公尺")
    # 租賃 = 「建物總面積平方公尺」
    c_bldg_area = col("building shifting total area square meter",
                      "building shifting total area",
                      "建物移轉總面積平方公尺", "建物總面積平方公尺")
    # 租賃 = 「車位面積平方公尺」
    c_park_area = col("berth shifting total area square meter",
                      "車位移轉總面積平方公尺", "車位面積平方公尺")
    # 租賃 = 「租賃層次」
    c_floor     = col("shifting level", "transferring floor", "移轉層次", "租賃層次")
    c_total_fl  = col("total floor number", "總樓層數")
    c_btype     = col("building state", "建物型態")
    c_main_use  = col("main use", "主要用途")
    c_material  = col("main building materials", "主要建材")
    c_complete  = col("construction to complete the years", "建築完成年月")
    c_rooms     = col("building present situation pattern - room", "建物現況格局-房")
    c_halls     = col("building present situation pattern - hall", "建物現況格局-廳")
    c_baths     = col("building present situation pattern - health", "建物現況格局-衛")
    c_partition = col("building present situation pattern - compartmented", "建物現況格局-隔間")
    c_mgmt      = col("Whether there is manages the organization", "有無管理組織")
    # 租賃 = 「租賃年月日」
    c_deal_dt   = col("transaction year month and day", "交易年月日", "租賃年月日")
    # 租賃 = 「總額元」、「車位總額元」
    c_total_pr  = col("total price NTD", "總價元", "總額元")
    c_unit_pr   = col("the unit price (NTD / square meter)", "單價元平方公尺")
    c_park_kind = col("the berth category", "車位類別")
    c_park_pr   = col("the berth total price NTD", "車位總價元", "車位總額元")
    c_note      = col("the note", "備註")
    c_serial    = col("serial number", "編號")

    for row in df.to_dict("records"):
        deal_dt = parse_roc_date(row.get(c_deal_dt) if c_deal_dt else None)
        if deal_dt is None:
            continue

        bldg_area = parse_dec(row.get(c_bldg_area) if c_bldg_area else None)
        unit_per_sqm = parse_dec(row.get(c_unit_pr) if c_unit_pr else None)
        unit_per_ping = float(unit_per_sqm * Decimal(SQM_PER_PING)) if unit_per_sqm else None

        completion = parse_roc_date(row.get(c_complete) if c_complete else None)
        age = None
        if completion and deal_dt:
            age = round((deal_dt - completion).days / 365.25, 1)

        note_text = (row.get(c_note) if c_note else None) or ""
        serial_no = (row.get(c_serial) if c_serial else "") or ""
        if not serial_no:
            continue

        district_val = (row.get(c_district) if c_district else "") or ""
        addr_val = row.get(c_addr) if c_addr else None
        road = extract_road(addr_val, district_val)

        yield {
            "serial_no": serial_no,
            "deal_kind": deal_kind,
            "county_code": county_code,
            "county_name": METRO_CODES[county_code],
            "district": district_val,
            "address": addr_val,
            "road": road,
            "land_area_sqm": float(parse_dec(row.get(c_land_area) if c_land_area else None) or 0) or None,
            "building_area_sqm": float(bldg_area) if bldg_area is not None else None,
            "parking_area_sqm": float(parse_dec(row.get(c_park_area) if c_park_area else None) or 0) or None,
            "transfer_floor": row.get(c_floor) if c_floor else None,
            "transfer_floor_num": parse_floor(row.get(c_floor) if c_floor else None),
            "total_floors": parse_floor(row.get(c_total_fl) if c_total_fl else None),
            "building_type": row.get(c_btype) if c_btype else None,
            "main_use": row.get(c_main_use) if c_main_use else None,
            "main_material": row.get(c_material) if c_material else None,
            "build_completion": completion.isoformat() if completion else None,
            "age_years": age,
            "rooms": _smallint(parse_int(row.get(c_rooms) if c_rooms else None)),
            "halls": _smallint(parse_int(row.get(c_halls) if c_halls else None)),
            "baths": _smallint(parse_int(row.get(c_baths) if c_baths else None)),
            "has_partition": parse_yes(row.get(c_partition) if c_partition else None),
            "has_management": parse_yes(row.get(c_mgmt) if c_mgmt else None),
            "deal_date": deal_dt.isoformat(),
            "total_price": parse_int(row.get(c_total_pr) if c_total_pr else None),
            "unit_price_per_sqm": float(unit_per_sqm) if unit_per_sqm is not None else None,
            "unit_price_per_ping": unit_per_ping,
            "parking_kind": row.get(c_park_kind) if c_park_kind else None,
            "parking_price": parse_int(row.get(c_park_pr) if c_park_pr else None),
            "note": note_text or None,
            "is_special_deal": detect_special_deal(note_text),
            "source_season": source_season,
        }
