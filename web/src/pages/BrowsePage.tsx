import { useEffect, useMemo, useState } from "react";
import { data, type DealKind, type Meta, type RecentRow } from "../lib/data";
import { fmt, fmtPing, fmtWan, fmtDate } from "../lib/format";
import DealKindTabs from "../components/DealKindTabs";
import Section from "../components/Section";

export default function BrowsePage({ meta }: { meta: Meta | null }) {
  const [cc, setCc] = useState("a");
  const [dk, setDk] = useState<DealKind>("sale");
  const [rows, setRows] = useState<RecentRow[]>([]);
  const [district, setDistrict] = useState("");
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<"deal_date" | "unit_price_per_ping" | "total_price">("deal_date");
  const [order, setOrder] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    data.recent(cc, dk).then(setRows).catch(() => setRows([]));
  }, [cc, dk]);

  const counties = meta?.counties ?? [];
  const districts = meta?.districts?.[cc] ?? [];

  const filtered = useMemo(() => {
    let xs = rows;
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
  }, [rows, district, q, sortKey, order]);

  const setSort = (k: typeof sortKey) => {
    if (k === sortKey) setOrder(o => o === "asc" ? "desc" : "asc");
    else { setSortKey(k); setOrder("desc"); }
  };

  return (
    <div className="space-y-6">
      <div className="panel flex flex-wrap items-center gap-3 p-4">
        <select className="rounded-md border border-ink-200 bg-white px-3 py-1.5 text-sm"
                value={cc} onChange={e => { setCc(e.target.value); setDistrict(""); }}>
          {counties.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
        <select className="rounded-md border border-ink-200 bg-white px-3 py-1.5 text-sm"
                value={district} onChange={e => setDistrict(e.target.value)}>
          <option value="">— 全部鄉鎮 —</option>
          {districts.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <input
          className="flex-1 min-w-[180px] rounded-md border border-ink-200 bg-white px-3 py-1.5 text-sm"
          placeholder="搜尋地址（路名、街等）"
          value={q} onChange={e => setQ(e.target.value)}
        />
        <DealKindTabs value={dk} onChange={setDk} />
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
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.serial_no}>
                  <td className="stat-num text-ink-500">{fmtDate(r.deal_date)}</td>
                  <td className="text-ink-700">{r.district}</td>
                  <td className="text-ink-900 max-w-[260px] truncate" title={r.address ?? ""}>{r.address ?? "—"}</td>
                  <td className="text-ink-500">{r.building_type ?? "—"}</td>
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
                </tr>
              ))}
              {!filtered.length && (
                <tr><td colSpan={9} className="py-10 text-center text-ink-400">無資料 — 篩選太嚴或 pipeline 還沒跑</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <p className="text-xs text-ink-500 leading-relaxed">
        ※ 此頁顯示每縣市每類別預烘的「最新 2000 筆」。完整資料（每縣市買賣 7~12 萬筆）已在 Parquet 中，
        後續加入 DuckDB-WASM 後可在瀏覽器直接跑任意 SQL，真正零後端。
      </p>
    </div>
  );
}
