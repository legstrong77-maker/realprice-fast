"""CLI 進入點。

用法（在 pipeline/ 資料夾下）：
  python -m realprice download --since 112        # 下載 ROC 112 至今所有季的 ZIP
  python -m realprice build                       # 把 raw CSV 解析 → Parquet
  python -m realprice snapshot                    # 用 Parquet 產出聚合 JSON
  python -m realprice sync-web                    # 把 JSON 複製到 web/public/data/
  python -m realprice all --since 112             # 一鍵：下載 + build + snapshot + sync
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from loguru import logger

# 讓 src layout 在沒安裝套件的情況下也能 `python -m realprice` 跑
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from realprice.build import build_parquet, collect_records_for_seasons
from realprice.download import all_seasons_since, latest_season
from realprice.snapshot import build_all_snapshots, sync_to_web_public


def cmd_download(args) -> None:
    seasons = all_seasons_since(args.since) if args.season is None else [args.season]
    logger.info(f"準備下載 {len(seasons)} 季：{seasons}")
    from realprice.download import download_season, extract
    for s in seasons:
        try:
            zp = download_season(s)
            extract(zp)
        except Exception as e:
            logger.warning(f"[skip] {s}: {e}")


def cmd_build(args) -> None:
    seasons = all_seasons_since(args.since) if args.season is None else [args.season]
    logger.info(f"build {len(seasons)} 季 → Parquet")
    records = collect_records_for_seasons(seasons)
    logger.info(f"共 {len(records):,} 筆 record")
    written = build_parquet(records)
    logger.info(f"寫了 {len(written)} 個 Parquet 檔")


def cmd_snapshot(_args) -> None:
    build_all_snapshots()


def cmd_sync_web(_args) -> None:
    sync_to_web_public()


def cmd_all(args) -> None:
    cmd_build(args)
    cmd_snapshot(args)
    cmd_sync_web(args)


def cmd_latest(args) -> None:
    """只抓當期旬報 + 已下載過的歷史季 → 重 build + snapshot + sync。"""
    from realprice.download import download_current
    download_current()  # 確保拿最新旬
    cmd_all(args)


def cmd_pois(_args) -> None:
    """從 OSM Overpass 抓 POI（捷運站、學校、嫌惡設施）→ snapshots/poi/*.json。"""
    from realprice.pois import build_pois
    counts = build_pois()
    logger.info(f"POI 總計：{counts}")


def cmd_geocode(args) -> None:
    """掃 Parquet 中所有路段 → 補進 geocode_cache。"""
    import duckdb
    from realprice.config import METRO_CODES, PARQUET_DIR
    from realprice.geocode import geocode_roads

    con = duckdb.connect()
    roads: list[tuple[str, str]] = []
    for cc in METRO_CODES:
        pq = PARQUET_DIR / f"sale-{cc}.parquet"
        if not pq.exists():
            continue
        path = str(pq).replace("\\", "/")
        sql = f"""
            SELECT road, COUNT(*) AS n
              FROM read_parquet('{path}')
             WHERE road IS NOT NULL AND road <> ''
             GROUP BY road
          ORDER BY n DESC
             LIMIT {args.top_per_county}
        """
        rows = con.execute(sql).fetchall()
        for road, _ in rows:
            roads.append((cc, road))
    logger.info(f"待 geocode 候選：{len(roads)} 個路段（每縣市最多 {args.top_per_county} 個）")
    geocode_roads(roads, max_count=args.max_count)


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="realprice", description="realprice-fast pipeline")
    sub = p.add_subparsers(dest="cmd", required=True)

    p_dl = sub.add_parser("download", help="下載 MOI ZIP（不解析）")
    p_dl.add_argument("--since", type=int, default=112, help="ROC 起始年（預設 112 = 2023）")
    p_dl.add_argument("--season", help="只跑單一季，例如 113S4")
    p_dl.set_defaults(func=cmd_download)

    p_build = sub.add_parser("build", help="解析 + 寫 Parquet")
    p_build.add_argument("--since", type=int, default=112)
    p_build.add_argument("--season", help="只 build 單一季")
    p_build.set_defaults(func=cmd_build)

    p_snap = sub.add_parser("snapshot", help="從 Parquet 產出聚合 JSON")
    p_snap.set_defaults(func=cmd_snapshot)

    p_sync = sub.add_parser("sync-web", help="把 snapshots 同步到 web/public/data")
    p_sync.set_defaults(func=cmd_sync_web)

    p_all = sub.add_parser("all", help="build + snapshot + sync-web")
    p_all.add_argument("--since", type=int, default=112)
    p_all.add_argument("--season", default=None)
    p_all.set_defaults(func=cmd_all)

    p_latest = sub.add_parser("latest", help="抓當期旬報 + 重新 build/snapshot/sync")
    p_latest.add_argument("--since", type=int, default=112)
    p_latest.add_argument("--season", default=None)
    p_latest.set_defaults(func=cmd_latest)

    p_poi = sub.add_parser("pois", help="從 OSM Overpass 抓全台 POI（捷運站、學校、嫌惡設施）")
    p_poi.set_defaults(func=cmd_pois)

    p_geo = sub.add_parser("geocode", help="把路段轉成 (lat,lng) 寫入 cache（用 OSM Nominatim，1 req/s）")
    p_geo.add_argument("--top-per-county", type=int, default=100,
                       help="每縣市抓前 N 個成交最多的路段（預設 100）")
    p_geo.add_argument("--max-count", type=int, default=None,
                       help="本次最多查多少個（避免一次跑太久）")
    p_geo.set_defaults(func=cmd_geocode)

    def cmd_addr_geocode(args2):
        from realprice.addr_geocode import (
            collect_addresses, geocode_addresses, apply_cache_to_recent_files,
            upgrade_existing_cache_with_osm,
        )
        if args2.upgrade_osm:
            upgrade_existing_cache_with_osm()
            if args2.apply_after:
                apply_cache_to_recent_files()
            return
        if args2.apply_only:
            apply_cache_to_recent_files()
            return
        candidates = collect_addresses()
        logger.info(f"recent files 蒐集到 {len(candidates)} 個唯一地址")
        if args2.counties:
            wanted = {c.strip() for c in args2.counties.split(",") if c.strip()}
            before = len(candidates)
            candidates = [t for t in candidates if t[0] in wanted]
            logger.info(
                f"--counties={sorted(wanted)} 過濾後 {len(candidates):,} / {before:,}"
            )
        geocode_addresses(
            candidates,
            max_count=args2.max_count,
            only_with_road_cache=args2.only_road_cached,
        )
        if args2.apply_after:
            apply_cache_to_recent_files()

    def cmd_osm_build(_args2):
        """從 OSM Taiwan PBF 抽門牌節點 → 建本地 SQLite 庫（一次性，要先 download PBF）。"""
        from realprice.osm_addr import build_db, OSM_PBF_PATH, ADDR_DB_PATH
        if not OSM_PBF_PATH.exists():
            logger.error(
                f"先抓 PBF：\n"
                f"  curl -sSL --create-dirs -o {OSM_PBF_PATH} "
                f"https://download.geofabrik.de/asia/taiwan-latest.osm.pbf"
            )
            sys.exit(1)
        n = build_db()
        logger.info(f"完成，{n:,} 筆寫入 {ADDR_DB_PATH}")

    p_osm = sub.add_parser("osm-build",
                            help="從 OSM Taiwan PBF 建本地門牌庫（5M+ 筆，~10 分鐘）")
    p_osm.set_defaults(func=cmd_osm_build)

    def cmd_osm_apply(args2):
        """用 OSM 本地庫 + 既有 Nominatim cache 一起套到 recent JSON。"""
        from realprice.addr_geocode import apply_cache_to_recent_files
        apply_cache_to_recent_files(use_osm=not args2.no_osm)

    p_oapp = sub.add_parser("osm-apply",
                             help="把 cache + OSM 本地庫的座標套到 recent/*.json（不查 Nominatim）")
    p_oapp.add_argument("--no-osm", action="store_true",
                        help="只套用 Nominatim cache，跳過 OSM（等同舊行為）")
    p_oapp.set_defaults(func=cmd_osm_apply)

    p_addr = sub.add_parser("addr-geocode",
                             help="逐筆地址 geocode → addr cache（用 OSM Nominatim，1 req/s）")
    p_addr.add_argument("--max-count", type=int, default=None,
                        help="本次最多查多少個（限縮 scope，避免一次跑太久）")
    p_addr.add_argument("--only-road-cached", action="store_true",
                        help="只查路段已被 geocode 過的地址（提升命中率，砍掉偏鄉路）")
    p_addr.add_argument("--counties", default=None,
                        help="只跑指定縣市代號（逗號分隔，例：g,j,m,n）")
    p_addr.add_argument("--upgrade-osm", action="store_true",
                        help="一次性升級：把已存在的 Nominatim 巷-level / not_found 用 OSM 門牌補")
    p_addr.add_argument("--apply-after", action="store_true",
                        help="跑完之後立刻把座標套用到 web/public/data/recent/*.json")
    p_addr.add_argument("--apply-only", action="store_true",
                        help="不查新的，只把現有 cache 套到 recent 檔上")
    p_addr.set_defaults(func=cmd_addr_geocode)

    args = p.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
