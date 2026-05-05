"""把 OSM Taiwan PBF 裡的門牌節點吸出來，建成一個本地 SQLite 查詢庫。

為什麼要這個：
  Nominatim 一秒一筆，11 萬筆要跑兩天還會被 ban。
  OSM 自己就有 addr:* 標籤的節點，全 Taiwan extract ~309 MB，
  解壓後抽 addr:* node 大概十幾萬筆，本地查 SQLite < 1 ms，
  比 Nominatim 快十萬倍而且不會被 ban。

流程：
  1. 確認 data/osm/taiwan-latest.osm.pbf 存在（沒有就請使用者跑 download）
  2. osmium handler 掃 PBF：node、way、area，凡有 addr:housenumber 就收
  3. 把 (城/區/街/號) 拼出標準化字串 → SQLite (normalized_addr → lat,lng)
  4. 同時建一個 (城/區/街/號) 的 fuzzy key 表：去段、去之X、半形數字
"""
from __future__ import annotations

import re
import sqlite3
import sys
import time
from pathlib import Path

import osmium
from loguru import logger

from .config import DATA_DIR

OSM_PBF_PATH = DATA_DIR / "osm" / "taiwan-latest.osm.pbf"
ADDR_DB_PATH = DATA_DIR / "osm" / "tw_addr.sqlite"
PBF_URL = "https://download.geofabrik.de/asia/taiwan-latest.osm.pbf"

# 全形 → 半形（含數字 + 英文字母）
_FW_TABLE = str.maketrans(
    "０１２３４５６７８９ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ"
    "ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ　",
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    "abcdefghijklmnopqrstuvwxyz ",
)

# 中文數字 → 阿拉伯（只處理段/巷/弄常見的一~十）
_CN_NUM = {
    "零": "0", "一": "1", "二": "2", "三": "3", "四": "4",
    "五": "5", "六": "6", "七": "7", "八": "8", "九": "9", "十": "10",
}


def normalize(addr: str) -> str:
    """把地址壓成 lookup key。

    規則：
      - 臺 → 台
      - 全形 → 半形
      - 砍掉開頭 3-6 碼郵遞區號（OSM Taiwan 的典型 "100001臺北市..." 模式）
      - 中文數字段 → 阿拉伯（"三段" → "3段"，"二十巷" 太罕見不處理）
      - 砍掉「X里」「N鄰」（OSM 把鄰里塞進地址，實價登錄不用）
      - 砍掉「N號」之後的所有東西（樓層、之X、樓之X）
      - 砍掉空白與雜訊符號（反斜線、多餘標點）
    """
    if not addr:
        return ""
    s = addr.replace("臺", "台").translate(_FW_TABLE)
    s = s.replace("\\", "").replace("　", "")
    # MOI 某些罕用字（如「館」「峯」）被編成 Big5-PUA → U+E000–U+F8FF
    # 砍掉純粹消失，雖然會丟資訊，但比丟整個查詢好
    s = re.sub(r"[-]", "", s)
    # 開頭郵遞區號（3碼舊制 / 5-6碼新制）— 後面要接中文才算
    s = re.sub(r"^\d{3,6}(?=[一-鿿])", "", s)
    # 中文數字段（一段、二段...十段）
    s = re.sub(
        r"([一二三四五六七八九十])段",
        lambda m: _CN_NUM[m.group(1)] + "段",
        s,
    )
    # 「XXX里NNN鄰」、「XXX里」、「NNN鄰」 — 砍掉
    # 限定 里 前面是非「區鄉鎮市」的中文，避免吃進「中正區光復里」的「正區光復」
    s = re.sub(r"(?<=[區鄉鎮市])[一-鿿]{1,4}里\d{0,3}鄰", "", s)
    s = re.sub(r"(?<=[區鄉鎮市])[一-鿿]{1,4}里", "", s)
    # 沒前面 區/鄉/鎮/市 的（OSM 格式不全的情況）— 只砍 里 + 鄰 連寫
    s = re.sub(r"^[一-鿿]{1,4}里\d{0,3}鄰", "", s)
    s = re.sub(r"\d{1,3}鄰", "", s)
    # 「N號X樓...」「N號之X」「N-M號...」 → 「N號」
    s = re.sub(r"(\d+(?:-\d+)?(?:之\d+)?號).*$", r"\1", s)
    # 統一 N之M號 / N-M號 → N之M號（OSM 兩種寫法都有）
    s = re.sub(r"(\d+)-(\d+)號", r"\1之\2號", s)
    s = re.sub(r"\s+", "", s)
    return s


# 縣市名前綴（用來 fallback 拆解 query）
_CITY_PREFIXES = (
    "台北市", "新北市", "桃園市", "台中市", "台南市", "高雄市",
    "基隆市", "新竹市", "新竹縣", "嘉義市", "嘉義縣",
    "宜蘭縣", "苗栗縣", "南投縣", "彰化縣", "雲林縣",
    "屏東縣", "花蓮縣", "台東縣", "澎湖縣", "金門縣", "連江縣",
)
# 區/鄉/鎮/市 後綴 — 砍 query 的「XX區/鄉/鎮/市」當第二層 fallback
_DISTRICT_RE = re.compile(r"^[一-鿿]{1,4}(區|鄉|鎮|市)")


def query_variants(addr: str) -> list[str]:
    """把 user query 拆出 lookup 變體（從最完整到最寬鬆）。

    OSM Taiwan 的標籤完整度差異大，有的有縣市區，有的只有路名。
    生成多個 key 都試一次，取第一個命中。
    """
    full = normalize(addr)
    if not full:
        return []
    out = [full]
    # 砍掉縣市
    s = full
    for pfx in _CITY_PREFIXES:
        if s.startswith(pfx):
            s = s[len(pfx):]
            out.append(s)
            break
    # 再砍掉「XX區/鄉/鎮/市」
    m = _DISTRICT_RE.match(s)
    if m:
        out.append(s[m.end():])
    # 去重保序
    seen, dedup = set(), []
    for x in out:
        if x and x not in seen:
            seen.add(x)
            dedup.append(x)
    return dedup


def _addr_from_tags(tags: dict) -> str | None:
    """從 OSM tags 組出完整地址字串。

    OSM Taiwan 標籤約定不一致，常見幾種模式：
      A. addr:full = "臺北市中山區新生北路三段80號"
      B. city + district + street + housenumber 分開
      C. district + street + housenumber（無 city）— 用後段的 region 補
    """
    if "addr:full" in tags:
        return tags["addr:full"]

    house = tags.get("addr:housenumber")
    if not house:
        return None

    parts = []
    for k in ("addr:city", "addr:district", "addr:subdistrict"):
        v = tags.get(k)
        if v:
            parts.append(v)
    street = tags.get("addr:street") or tags.get("addr:road")
    if street:
        parts.append(street)
    parts.append(house)

    if not street and not parts[:-1]:
        # 只有 housenumber、沒有路 — 沒辦法 lookup
        return None
    return "".join(parts)


class _AddrHandler(osmium.SimpleHandler):
    def __init__(self, sink_addr_callback):
        super().__init__()
        self.cb = sink_addr_callback
        self.n_nodes = 0
        self.n_ways = 0
        self.n_addrs = 0
        self._t0 = time.monotonic()

    def node(self, n):
        self.n_nodes += 1
        if not n.tags:
            return
        tags = {t.k: t.v for t in n.tags}
        if "addr:housenumber" not in tags and "addr:full" not in tags:
            return
        addr = _addr_from_tags(tags)
        if not addr:
            return
        self.cb(addr, n.location.lat, n.location.lon, "node")
        self.n_addrs += 1
        if self.n_addrs % 5000 == 0:
            self._tick()

    def way(self, w):
        # building polygons 偶爾掛 addr 標 — 但要拿座標需要算 centroid，先跳過
        # 之後想加，可以開 area handler 用 osmium.geom.WKBFactory
        self.n_ways += 1

    def _tick(self):
        dt = time.monotonic() - self._t0
        logger.info(
            f"  掃過 nodes={self.n_nodes:,} ways={self.n_ways:,} "
            f"取得 addrs={self.n_addrs:,} ({dt:.1f}s)"
        )


def build_db(pbf_path: Path = OSM_PBF_PATH, db_path: Path = ADDR_DB_PATH) -> int:
    """從 PBF 建 SQLite，回傳寫入筆數。"""
    if not pbf_path.exists():
        raise FileNotFoundError(
            f"找不到 {pbf_path}。先跑：\n"
            f"  curl -sSL -o {pbf_path} {PBF_URL}"
        )

    db_path.parent.mkdir(parents=True, exist_ok=True)
    if db_path.exists():
        db_path.unlink()

    con = sqlite3.connect(db_path)
    con.execute("PRAGMA journal_mode = OFF")
    con.execute("PRAGMA synchronous = OFF")
    con.execute("""
        CREATE TABLE addr (
            norm_key  TEXT NOT NULL,
            raw_addr  TEXT NOT NULL,
            lat       REAL NOT NULL,
            lng       REAL NOT NULL,
            kind      TEXT NOT NULL
        )
    """)
    inserted = [0]

    def sink(raw: str, lat: float, lon: float, kind: str):
        norm = normalize(raw)
        if not norm:
            return
        con.execute(
            "INSERT INTO addr(norm_key, raw_addr, lat, lng, kind) VALUES (?,?,?,?,?)",
            (norm, raw, lat, lon, kind),
        )
        inserted[0] += 1

    logger.info(f"開始解析 {pbf_path}（~{pbf_path.stat().st_size / 1e6:.0f} MB）")
    h = _AddrHandler(sink)
    h.apply_file(str(pbf_path), locations=False)
    con.commit()

    logger.info(f"建索引中...")
    # 同個地址 OSM 可能有多筆（building + node）— 平均座標當代表
    con.execute("""
        CREATE TABLE addr_unique AS
        SELECT norm_key, MIN(raw_addr) AS raw_addr,
               AVG(lat) AS lat, AVG(lng) AS lng, COUNT(*) AS hits
          FROM addr
         GROUP BY norm_key
    """)
    con.execute("CREATE UNIQUE INDEX idx_unique_norm ON addr_unique(norm_key)")
    # 砍 raw 表（已聚合）— 把 DB 從 ~3GB 降到 ~300MB
    con.execute("DROP TABLE addr")
    con.execute("VACUUM")
    con.commit()
    n_unique = con.execute("SELECT COUNT(*) FROM addr_unique").fetchone()[0]
    logger.info(f"完成：raw={inserted[0]:,} 筆，去重後 {n_unique:,} 個唯一門牌")
    con.close()
    return inserted[0]


_lookup_con: sqlite3.Connection | None = None


def _get_con() -> sqlite3.Connection | None:
    global _lookup_con
    if _lookup_con is not None:
        return _lookup_con
    if not ADDR_DB_PATH.exists():
        return None
    _lookup_con = sqlite3.connect(f"file:{ADDR_DB_PATH}?mode=ro", uri=True)
    return _lookup_con


_PUA_RE = re.compile("[-]")


def _fuzzy_pattern(addr: str) -> str | None:
    """如果原地址含 PUA 罕用字（MOI 舊資料常有），把 PUA 位置替成 SQL LIKE 的 '_'。

    其他地方仍用 normalize 規則（臺→台、全形→半形、砍郵碼/里/鄰/樓/之X）。
    回 None 表示沒有 PUA — 不需 fuzzy。
    """
    if not _PUA_RE.search(addr):
        return None
    placeholder = "☃"  # snowman 當佔位 — 一定不會被 normalize 動到
    masked = _PUA_RE.sub(placeholder, addr)
    norm = normalize(masked)
    if placeholder not in norm:
        return None
    return norm.replace(placeholder, "_")


def lookup(addr: str) -> tuple[float, float] | None:
    """完整門牌精準對；找不到回 None。會試「完整 / 砍縣市 / 砍縣市區」三種變體。
    若原地址含 Big5-PUA 罕用字，會額外做一次 LIKE 模糊比對。
    """
    con = _get_con()
    if con is None:
        return None
    for q in query_variants(addr):
        row = con.execute(
            "SELECT lat, lng FROM addr_unique WHERE norm_key = ?", (q,)
        ).fetchone()
        if row:
            return row
    # PUA fuzzy: prefix range scan + Python regex
    pat = _fuzzy_pattern(addr)
    if pat:
        prefix = pat.split("_", 1)[0]
        if len(prefix) >= 4:
            rx = re.compile("^" + pat.replace("_", "[一-鿿]") + "$")
            for row in con.execute(
                "SELECT lat, lng, norm_key FROM addr_unique WHERE norm_key >= ? AND norm_key < ? LIMIT 500",
                (prefix, prefix + "￿"),
            ):
                if rx.match(row[2]):
                    return (row[0], row[1])
    return None


def lookup_with_road_fallback(addr: str) -> tuple[float, float, str] | None:
    """完整門牌沒中 → 巷級 → 路級。回 (lat, lng, level)；level ∈ {"exact","lane","road"}。"""
    con = _get_con()
    if con is None:
        return None
    variants = query_variants(addr)
    for q in variants:
        row = con.execute(
            "SELECT lat, lng FROM addr_unique WHERE norm_key = ?", (q,)
        ).fetchone()
        if row:
            return (row[0], row[1], "exact")

    # PUA 罕用字 → 取 _ 前的 literal prefix 做 range scan，再用 regex 篩
    pat = _fuzzy_pattern(addr)
    if pat:
        prefix = pat.split("_", 1)[0]
        if len(prefix) >= 4:  # 太短的 prefix 會吐回幾百萬筆，不划算
            rx = re.compile("^" + pat.replace("_", "[一-鿿]") + "$")
            for row in con.execute(
                "SELECT lat, lng, norm_key FROM addr_unique WHERE norm_key >= ? AND norm_key < ? LIMIT 500",
                (prefix, prefix + "￿"),
            ):
                if rx.match(row[2]):
                    return (row[0], row[1], "exact")

    # 巷級 fallback：用 prefix range 取代表點（不算 AVG，省掉 5M-row scan）
    for q in variants:
        lane_match = re.match(r"^(.*?\d+巷)", q)
        if not lane_match:
            continue
        prefix = lane_match.group(1)
        row = con.execute(
            "SELECT lat, lng FROM addr_unique WHERE norm_key >= ? AND norm_key < ? LIMIT 1",
            (prefix, prefix + "￿"),
        ).fetchone()
        if row:
            return (row[0], row[1], "lane")

    # 路級 fallback
    for q in variants:
        road_match = re.match(r"^(.*?(?:路|街|大道)(?:\d+段)?)", q)
        if not road_match:
            continue
        prefix = road_match.group(1)
        row = con.execute(
            "SELECT lat, lng FROM addr_unique WHERE norm_key >= ? AND norm_key < ? LIMIT 1",
            (prefix, prefix + "￿"),
        ).fetchone()
        if row:
            return (row[0], row[1], "road")
    return None


def stats() -> dict:
    """回 DB 概況：總筆數、覆蓋的縣市分布。"""
    con = _get_con()
    if con is None:
        return {"error": "DB 不存在，先跑 build_db()"}
    n = con.execute("SELECT COUNT(*) FROM addr_unique").fetchone()[0]
    by_city = con.execute("""
        SELECT substr(norm_key, 1, 3) AS city, COUNT(*) AS n
          FROM addr_unique
         WHERE norm_key LIKE '台%' OR norm_key LIKE '新%'
            OR norm_key LIKE '桃%' OR norm_key LIKE '高%'
            OR norm_key LIKE '基%' OR norm_key LIKE '宜%'
            OR norm_key LIKE '苗%' OR norm_key LIKE '彰%'
            OR norm_key LIKE '南%' OR norm_key LIKE '雲%'
            OR norm_key LIKE '嘉%' OR norm_key LIKE '屏%'
            OR norm_key LIKE '花%' OR norm_key LIKE '澎%'
            OR norm_key LIKE '金%' OR norm_key LIKE '連%'
         GROUP BY city
         ORDER BY n DESC
    """).fetchall()
    return {"total": n, "by_city": dict(by_city)}


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    n = build_db()
    logger.info(f"OK，{n} 筆寫入 {ADDR_DB_PATH}")
    print(stats())
