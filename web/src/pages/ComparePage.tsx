import { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid,
  Legend,
} from "recharts";
import { data, type DealKind, type Meta, type HeatmapRow, type MonthlyRow } from "../lib/data";
import { fmt, fmtPing, fmtWan, fmtPct } from "../lib/format";
import DealKindTabs from "../components/DealKindTabs";
import Section from "../components/Section";

type Pick = { county: string; district: string };

const COLORS = ["#1d4ed8", "#047857", "#b45309", "#9333ea", "#0e7490"];

export default function ComparePage({ meta }: { meta: Meta | null }) {
  const [dk, setDk] = useState<DealKind>("sale");
  const [picks, setPicks] = useState<Pick[]>([
    { county: "a", district: "信義區" },
    { county: "f", district: "板橋區" },
  ]);

  const counties = meta?.counties ?? [];

  // 每個 pick 都抓 monthly + heatmap (用 heatmap 找 deal 量、median)
  const [seriesByPick, setSeriesByPick] = useState<Record<string, MonthlyRow[]>>({});
  const [heatByCounty, setHeatByCounty] = useState<Record<string, HeatmapRow[]>>({});

  useEffect(() => {
    setSeriesByPick({});
    picks.forEach((p) => {
      if (!p.district) return;
      data.monthly(p.county, p.district, dk).then((rows) => {
        setSeriesByPick((s) => ({ ...s, [`${p.county}|${p.district}`]: rows }));
      }).catch(() => {});
    });
    const counties = Array.from(new Set(picks.map(p => p.county)));
    counties.forEach((cc) => {
      data.heatmap(cc, dk).then((rows) => {
        setHeatByCounty((s) => ({ ...s, [cc]: rows }));
      }).catch(() => {});
    });
  }, [picks, dk]);

  const addPick = () => {
    if (picks.length >= 5) return;
    setPicks([...picks, { county: counties[0]?.code ?? "a", district: "" }]);
  };
  const removePick = (i: number) => setPicks(picks.filter((_, idx) => idx !== i));
  const updatePick = (i: number, next: Partial<Pick>) =>
    setPicks(picks.map((p, idx) => idx === i ? { ...p, ...next } : p));

  // 對齊 monthly：取所有月份的 union
  const merged = useMemo(() => {
    const months = new Set<string>();
    picks.forEach((p) => {
      const k = `${p.county}|${p.district}`;
      (seriesByPick[k] ?? []).forEach((r) => months.add(r.month));
    });
    const sortedMonths = [...months].sort();
    return sortedMonths.map((m) => {
      const row: any = { month: m.slice(0, 7) };
      picks.forEach((p) => {
        const k = `${p.county}|${p.district}`;
        const found = seriesByPick[k]?.find(r => r.month === m);
        row[k] = found?.median_unit_price_ping ? found.median_unit_price_ping / 10000 : null;
      });
      return row;
    });
  }, [picks, seriesByPick]);

  // KPI table data
  const summary = useMemo(() => picks.map((p, i) => {
    const heat = heatByCounty[p.county]?.find(h => h.district === p.district);
    const k = `${p.county}|${p.district}`;
    const series = seriesByPick[k] ?? [];
    const recent6 = series.slice(-6);
    const prev6 = series.slice(-12, -6);
    const avg = (xs: MonthlyRow[]) => {
      const ys = xs.map(r => r.median_unit_price_ping ?? 0).filter(Boolean);
      return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : null;
    };
    const a = avg(recent6); const b = avg(prev6);
    const pct = (a && b) ? (a - b) / b : null;
    return {
      idx: i,
      color: COLORS[i % COLORS.length],
      pick: p,
      county_name: counties.find(c => c.code === p.county)?.name ?? p.county,
      heat,
      pct_change: pct,
    };
  }), [picks, heatByCounty, seriesByPick, counties]);

  return (
    <div className="space-y-6">
      <section className="panel p-8">
        <div className="label">Side-by-side</div>
        <h1 className="mt-2 font-serif text-3xl text-ink-900">多區並排比較</h1>
        <p className="mt-3 max-w-2xl text-ink-600 leading-7">
          同時看 2~5 個鄉鎮的中位價、近 12 月成交、價格動能與月度走勢。
          看你猶豫的兩個區，到底差多少。
        </p>
      </section>

      {/* 控制條 */}
      <div className="panel p-4 space-y-3">
        <div className="flex justify-between items-center">
          <DealKindTabs value={dk} onChange={setDk} />
          <button onClick={addPick} disabled={picks.length >= 5}
                  className={`btn ${picks.length >= 5 ? "opacity-40 cursor-not-allowed" : ""}`}>
            + 加一個比較區
          </button>
        </div>
        <div className="grid gap-2">
          {picks.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: COLORS[i] }} />
              <select className="rounded-md border border-ink-200 bg-white px-3 py-1.5 text-sm"
                      value={p.county}
                      onChange={e => updatePick(i, { county: e.target.value, district: "" })}>
                {counties.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
              <select className="rounded-md border border-ink-200 bg-white px-3 py-1.5 text-sm flex-1"
                      value={p.district}
                      onChange={e => updatePick(i, { district: e.target.value })}>
                <option value="">— 選鄉鎮 —</option>
                {(meta?.districts?.[p.county] ?? []).map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              {picks.length > 1 && (
                <button onClick={() => removePick(i)} className="btn text-down border-down/30">移除</button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* KPI 並排 */}
      <Section kicker="近 12 月" title="關鍵指標">
        <div className={`grid gap-3 grid-cols-1 ${picks.length >= 2 ? "md:grid-cols-2" : ""} ${picks.length >= 3 ? "lg:grid-cols-3" : ""}`}>
          {summary.map(s => (
            <div key={s.idx} className="rounded-md border border-ink-200 bg-white p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="inline-block w-3 h-3 rounded-full" style={{ background: s.color }} />
                <div>
                  <div className="text-[11px] uppercase tracking-[0.12em] text-ink-500">{s.county_name}</div>
                  <div className="font-serif text-xl text-ink-900">{s.pick.district || "未選"}</div>
                </div>
              </div>
              <dl className="space-y-2 text-sm">
                <KV k="中位 萬/坪" v={s.heat ? `${fmtPing(s.heat.median_unit_price_ping)}` : "—"} />
                <KV k="均價 萬/坪" v={s.heat ? `${fmtPing(s.heat.avg_unit_price_ping)}` : "—"} />
                <KV k="中位總價 (萬)" v={s.heat ? `${fmtWan(s.heat.median_total_price)}` : "—"} />
                <KV k="近 12 月成交" v={s.heat ? `${fmt(s.heat.deals)} 筆` : "—"} />
                <KV
                  k="近 6 月 vs 前 6 月"
                  v={s.pct_change != null ? fmtPct(s.pct_change) : "—"}
                  className={s.pct_change != null ? (s.pct_change > 0 ? "text-up" : "text-down") : ""}
                />
              </dl>
            </div>
          ))}
        </div>
      </Section>

      {/* 月度走勢比較 */}
      <Section
        kicker="月度走勢"
        title="中位 萬/坪"
        right={<span className="text-xs text-ink-500">過去 60 個月</span>}
      >
        <div className="h-[360px]">
          {merged.length ? (
            <ResponsiveContainer>
              <LineChart data={merged} margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#e7e5e4" vertical={false} />
                <XAxis dataKey="month" stroke="#a8a29e" />
                <YAxis stroke="#a8a29e" tickFormatter={(v: any)=>`${(+v).toFixed(0)}`} />
                <Tooltip
                  contentStyle={{ background: "#1c1917", border: "none", color: "#fafaf9", fontSize: 12, borderRadius: 6 }}
                  formatter={(v: any) => [`${(+v).toFixed(1)} 萬/坪`, ""]}
                  labelFormatter={(label: any) => label}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {picks.map((p, i) => p.district && (
                  <Line
                    key={`${p.county}|${p.district}`}
                    type="monotone"
                    dataKey={`${p.county}|${p.district}`}
                    stroke={COLORS[i]}
                    strokeWidth={2}
                    dot={false}
                    name={`${counties.find(c => c.code === p.county)?.name?.replace("市","")} · ${p.district}`}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-ink-400">選好鄉鎮後就會顯示</div>
          )}
        </div>
      </Section>
    </div>
  );
}

function KV({ k, v, className = "" }: { k: string; v: string; className?: string }) {
  return (
    <div className="flex justify-between border-b border-dotted border-ink-200 pb-1.5">
      <dt className="text-ink-500">{k}</dt>
      <dd className={`stat-num text-ink-900 ${className}`}>{v}</dd>
    </div>
  );
}
