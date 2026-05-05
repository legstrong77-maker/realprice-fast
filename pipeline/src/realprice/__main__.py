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

    p_geo = sub.add_parser("geocode", help="把路段轉成 (lat,lng) 寫入 cache（用 OSM Nominatim，1 req/s）")
    p_geo.add_argument("--top-per-county", type=int, default=100,
                       help="每縣市抓前 N 個成交最多的路段（預設 100）")
    p_geo.add_argument("--max-count", type=int, default=None,
                       help="本次最多查多少個（避免一次跑太久）")
    p_geo.set_defaults(func=cmd_geocode)

    args = p.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
