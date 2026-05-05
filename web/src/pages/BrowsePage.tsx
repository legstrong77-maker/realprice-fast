import { useEffect, useMemo, useState } from "react";
import {
  data, type DealKind, type Meta, type RecentRow, type RoadHistoryDeal,
} from "../lib/data";
import { fmt, fmtPing, fmtWan, fmtDate } from "../lib/format";
import DealKindTabs from "../components/DealKindTabs";
import Section from "../components/Section";

export default function BrowsePage({ meta }: { meta: Meta | null }) {
  const [cc, setCc] = useState("a");
  const [dk, setDk] = useState<DealKind>("sale");
  const [rows, setRows] = useState<RecentRow[]>([]);
  const [district, setDistrict] = useState("");
  const [q, setQ] = useState("");
  const [showSpecial, setShowSpecial] = useState(false);
  const [sortKey, setSortKey] = useState<"deal_date" | "unit_price_per_ping" | "total_price">("deal_date");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [expandedRoad, setExpandedRoad] = useState<string | null>(null);
  const [roadHistory, setRoadHistory] = useState<Record<string, RoadHistoryDeal[]> | null>(null);

  useEffect(() => {
    data.recent(cc, dk).then(setRows).catch(() => setRows([]));
    setExpandedRoad(null);
  }, [cc, dk]);

  // 同社區成交：lazy 載入該縣市的整份 road-history（只在用戶展開時）
  useEffect(() => {
    if (!expandedRoad || roadHistory) return;
    data.roadHistory(cc).then(setRoadHistory).catch(() => setRoadHistory({}));
  }, [expandedRoad, cc, roadHistory]);

  // 切縣市時清空 road-history cache
  useEffect(() => { setRoadHistory(null); }, [cc]);

  const counties = meta?.counties ?? [];
  const districts = meta?.districts?.[cc] ?? [];

  const filtered = useMemo(() => {
    let xs = rows;
    if (!showSpecial) xs = xs.filter(r => !r.is_special_deal);
    if (district) xs = xs.filter(r => r.district === district);
    if (q) {
      const k = q.toLowerCase();
      xs = xs.filter(r => (r.address ?? "").toLowerCase().includes(k));
    }
    xs = [...xs].sort((a, b) => {
      const av = a[sortKey] ?? 0; const bv = b[sortKey] ?? 0;
      if (av === bv) return 0;
      const dir = order === "asc" ? 1 : -1;
      return av < bv ? -1 * dir : dir;
    });
    return xs;
  }, [rows, showSpecial, district, q, sortKey, order]);

  const setSort = (k: typeof sortKey) => {
    if (k === sortKey) setOrder(o => o === "asc" ? "desc" : "asc");
    else { setSortKey(k); setOrder("desc"); }
  };

  const specialCount = rows.filter(r => r.is_special_deal).length;

  return (
    <div className="space-y-6">
      <div className="panel flex flex-wrap items-center gap-3 p-4">
        <select className="input max-w-[140px]"
                value={cc} onChange={e => { setCc(e.target.value); setDistrict(""); }}>
          {counties.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
        <select className="input max-w-[180px]"
                value={district} onChange={e => setDistrict(e.target.value)}>
          <option value="">— 全部鄉鎮 —</option>
          {districts.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <input
          className="input flex-1 min-w-[180px]"
          placeholder="搜尋地址（路名、街等）"
          value={q} onChange={e => setQ(e.target.value)}
        />
        <DealKindTabs value={dk} onChange={setDk} />
      </div>

      {/* 特殊註記切換 */}
      <div className="panel flex items-center justify-between p-3 px-5">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input type="checkbox"
                   checked={showSpecial}
                   onChange={e => setShowSpecial(e.target.checked)}
                   className="w-4 h-4 accent-down" />
            <span className={showSpecial ? "text-ink-900 font-medium" : "text-ink-700"}>
              顯示特殊註記交易
            </span>
          </label>
          <span className="text-xs text-ink-500">
            （凶宅 / 急售 / 親友 / 員工 / 債務 — 共 {fmt(specialCount)} 筆）
          </span>
        </div>
        {showSpecial && (
          <span className="text-xs text-down font-medium">⚠ 已包含特殊交易，價位可能異常</span>
        )}
      </div>

      <Section
        kicker="預烘 · 最近 2000 筆"
        title="近期成交"
        right={
          <span className="text-xs text-ink-500">
            顯示 <span className="stat-num text-ink-900">{fmt(filtered.length)}</span> /
            共 <span className="stat-num text-ink-900">{fmt(rows.length)}</span> 筆
          </span>
        }
      >
        <div className="overflow-x-auto">
          <table className="table-clean w-full">
            <thead>
              <tr>
                <th className="cursor-pointer" onClick={() => setSort("deal_date")}>成交日 {sortKey==="deal_date" && (order==="asc" ? "↑" : "↓")}</th>
                <th>鄉鎮</th>
                <th>地址</th>
                <th>類型</th>
                <th className="text-right">坪數</th>
                <th className="text-right">格局</th>
                <th className="text-right">屋齡</th>
                <th className="cursor-pointer text-right" onClick={() => setSort("unit_price_per_ping")}>萬/坪 {sortKey==="unit_price_per_ping" && (order==="asc" ? "↑" : "↓")}</th>
                <th className="cursor-pointer text-right" onClick={() => setSort("total_price")}>總價(萬) {sortKey==="total_price" && (order==="asc" ? "↑" : "↓")}</th>
                <th className="text-right">同社區</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const isExpanded = expandedRoad === r.road;
                const history = roadHistory?.[r.road ?? ""] ?? [];
                return (
                  <>
                    <tr key={r.serial_no}
                        className={r.is_special_deal ? "bg-rose-50/50" : ""}>
                      <td className="stat-num text-ink-500">
                        {fmtDate(r.deal_date)}
                        {r.is_special_deal && <span className="ml-1 text-down" title={r.note ?? ""}>⚠</span>}
                      </td>
                      <td className="text-ink-700">{r.district}</td>
                      <td className="text-ink-900 max-w-[260px] truncate" title={r.address ?? ""}>{r.address ?? "—"}</td>
                      <td className="text-ink-500 text-xs">{r.building_type ?? "—"}</td>
                      <td className="text-right stat-num">
                        {r.building_area_sqm ? (r.building_area_sqm / 3.305785).toFixed(1) : "—"}
                      </td>
                      <td className="text-right stat-num text-ink-500">
                        {[r.rooms, r.halls, r.baths].some(x => x != null)
                          ? `${r.rooms ?? 0}房${r.halls ?? 0}廳${r.baths ?? 0}衛`
                          : "—"}
                      </td>
                      <td className="text-right stat-num text-ink-500">
                        {r.age_years != null ? `${r.age_years}年` : "—"}
                      </td>
                      <td className="text-right stat-num font-medium">{fmtPing(r.unit_price_per_ping)}</td>
                      <td className="text-right stat-num">{fmtWan(r.total_price)}</td>
                      <td className="text-right">
                        {r.road ? (
                          <button
                            className="text-xs text-accent hover:underline"
                            onClick={() => setExpandedRoad(isExpanded ? null : r.road)}
                          >
                            {isExpanded ? "收合 ↑" : "看歷史 ↓"}
                          </button>
                        ) : "—"}
                      </td>
                    </tr>
                    {isExpanded && r.road && (
                      <tr>
                        <td colSpan={10} className="bg-ink-50 px-5 py-4">
                          <RoadHistoryView
                            road={r.road}
                            history={history}
                            loading={!roadHistory}
                            currentSerial={r.serial_no}
                          />
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
              {!filtered.length && (
                <tr><td colSpan={10} className="py-10 text-center text-ink-400">無資料 — 篩選太嚴或 pipeline 還沒跑</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <p className="text-xs text-ink-500 leading-relaxed">
        ※ 此頁顯示每縣市每類別預烘的「最新 2000 筆」。可勾選顯示特殊註記、可展開看同路段歷史成交。
      </p>
    </div>
  );
}

function RoadHistoryView({ road, history, loading, currentSerial }: {
  road: string; history: RoadHistoryDeal[]; loading: boolean; currentSerial: string;
}) {
  const sorted = [...history].sort((a, b) => b.deal_date.localeCompare(a.deal_date));
  if (loading) return <div className="text-sm text-ink-500">載入同路段歷史中...</div>;
  if (!sorted.length) return <div className="text-sm text-ink-500">同路段歷史資料不足（&lt; 3 筆）</div>;

  // 統計
  const prices = sorted.map(d => d.unit_price_per_ping ?? 0).filter(Boolean);
  const med = prices.length ? prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)] : null;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <div className="label">同路段近 36 月成交</div>
          <div className="font-serif text-lg text-ink-900">{road}</div>
        </div>
        <div className="text-xs text-ink-500">
          共 <span className="stat-num text-ink-900">{sorted.length}</span> 筆 ·
          中位 <span className="stat-num text-ink-900">{med ? (med / 10000).toFixed(1) : "—"}</span> 萬/坪
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-ink-500 border-b border-ink-200">
              <th className="text-left py-1.5 px-2">成交日</th>
              <th className="text-left py-1.5 px-2">地址</th>
              <th className="text-left py-1.5 px-2">類型</th>
              <th className="text-right py-1.5 px-2">坪數</th>
              <th className="text-right py-1.5 px-2">屋齡</th>
              <th className="text-right py-1.5 px-2">萬/坪</th>
              <th className="text-right py-1.5 px-2">總價(萬)</th>
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, 30).map((d, i) => (
              <tr key={i} className="border-b border-ink-100 hover:bg-white">
                <td className="stat-num text-ink-500 py-1 px-2">{fmtDate(d.deal_date)}</td>
                <td className="text-ink-800 max-w-[220px] truncate py-1 px-2" title={d.address ?? ""}>{d.address ?? "—"}</td>
                <td className="text-ink-500 py-1 px-2">{d.building_type ?? "—"}</td>
                <td className="text-right stat-num py-1 px-2">
                  {d.building_area_sqm ? (d.building_area_sqm / 3.305785).toFixed(1) : "—"}
                </td>
                <td className="text-right stat-num text-ink-500 py-1 px-2">
                  {d.age_years != null ? `${d.age_years}年` : "—"}
                </td>
                <td className="text-right stat-num font-medium py-1 px-2">{fmtPing(d.unit_price_per_ping)}</td>
                <td className="text-right stat-num py-1 px-2">{fmtWan(d.total_price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > 30 && (
        <div className="mt-2 text-xs text-ink-400">… 顯示前 30 筆</div>
      )}
    </div>
  );
}
