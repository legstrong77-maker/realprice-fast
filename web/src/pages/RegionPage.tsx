import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid,
  ComposedChart, Bar,
} from "recharts";
import {
  data, type DealKind, type HeatmapRow, type Meta, type MomentumRow,
  type MonthlyRow, type DistributionPayload,
  type BuildingTypeRow, type AgeBucketRow, type SizeBucketRow,
} from "../lib/data";
import { fmt, fmtPct, fmtPing, fmtWan } from "../lib/format";
import { Kpi, KpiBar } from "../components/KpiBar";
import DealKindTabs from "../components/DealKindTabs";
import Section from "../components/Section";

export default function RegionPage({ meta }: { meta: Meta | null }) {
  const [params, setParams] = useSearchParams();
  const cc = params.get("county") ?? "a";
  const dk = (params.get("dk") as DealKind) ?? "sale";
  const district = params.get("district") ?? "";

  const [heatmap, setHeatmap] = useState<HeatmapRow[]>([]);
  const [momentum, setMomentum] = useState<MomentumRow[]>([]);
  const [dist, setDist] = useState<DistributionPayload | null>(null);
  const [monthly, setMonthly] = useState<MonthlyRow[]>([]);
  const [bldgTypes, setBldgTypes] = useState<BuildingTypeRow[]>([]);
  const [ageBuckets, setAgeBuckets] = useState<AgeBucketRow[]>([]);
  const [sizeBuckets, setSizeBuckets] = useState<SizeBucketRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  // 縣市 / 種類 一變就抓
  useEffect(() => {
    setErr(null);
    data.heatmap(cc, dk).then(setHeatmap).catch(() => setHeatmap([]));
    data.momentum(cc, dk).then(setMomentum).catch(() => setMomentum([]));
    data.distribution(cc, dk).then(setDist).catch(() => setDist(null));
    data.buildingType(cc, dk).then(setBldgTypes).catch(() => setBldgTypes([]));
  }, [cc, dk]);

  // 屋齡 / 坪數分箱（只 sale 有意義）
  useEffect(() => {
    data.ageBuckets(cc).then(setAgeBuckets).catch(() => setAgeBuckets([]));
    data.sizeBuckets(cc).then(setSizeBuckets).catch(() => setSizeBuckets([]));
  }, [cc]);

  // 鄉鎮選擇 / 重置時抓月度
  useEffect(() => {
    if (!district) { setMonthly([]); return; }
    data.monthly(cc, district, dk)
      .then(setMonthly)
      .catch((e) => { setErr(String(e)); setMonthly([]); });
  }, [cc, district, dk]);

  const counties = meta?.counties ?? [];
  const districts = meta?.districts?.[cc] ?? [];

  const setQ = (next: Partial<{ county: string; dk: DealKind; district: string }>) => {
    const p = new URLSearchParams(params);
    if (next.county !== undefined)   { p.set("county", next.county); p.delete("district"); }
    if (next.dk !== undefined)       p.set("dk", next.dk);
    if (next.district !== undefined) p.set("district", next.district);
    setParams(p, { replace: true });
  };

  const totalDeals = heatmap.reduce((s, r) => s + (r.deals ?? 0), 0);
  const cityMedian = useMemo(() => {
    const xs = heatmap.map(r => r.median_unit_price_ping ?? 0).filter(Boolean);
    return xs.length ? xs.reduce((a,b)=>a+b,0) / xs.length : null;
  }, [heatmap]);

  const top = [...heatmap].sort((a,b)=> (b.median_unit_price_ping??0) - (a.median_unit_price_ping??0))[0];

  return (
    <div className="space-y-8">
      {/* 控制條 */}
      <div className="panel flex flex-wrap items-center gap-3 p-4">
        <select
          className="rounded-md border border-ink-200 bg-white px-3 py-1.5 text-sm"
          value={cc}
          onChange={(e) => setQ({ county: e.target.value })}
        >
          {counties.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>

        <select
          className="rounded-md border border-ink-200 bg-white px-3 py-1.5 text-sm"
          value={district}
          onChange={(e) => setQ({ district: e.target.value })}
        >
          <option value="">— 全縣市 —</option>
          {districts.map(d => <option key={d} value={d}>{d}</option>)}
        </select>

        <div className="ml-auto">
          <DealKindTabs value={dk} onChange={(v) => setQ({ dk: v })} />
        </div>
      </div>

      {err && <div className="rounded border border-down/30 bg-red-50 px-4 py-3 text-sm text-down">{err}</div>}

      {/* KPI */}
      <KpiBar>
        <Kpi label="鄉鎮數" value={fmt(heatmap.length)} sub="該縣市有效鄉鎮" />
        <Kpi label="近 12 月成交" value={fmt(totalDeals)} sub="排除特殊交易與雜訊" />
        <Kpi label="縣市中位均價" value={cityMedian ? `${fmtPing(cityMedian)} 萬/坪` : "—"} sub="各鄉鎮中位之平均" />
        <Kpi label="最貴鄉鎮" value={top ? top.district : "—"} sub={top ? `${fmtPing(top.median_unit_price_ping)} 萬/坪` : "—"} />
      </KpiBar>

      {/* 月度趨勢（選了鄉鎮才顯示） */}
      {district && (
        <Section
          kicker={`${counties.find(c=>c.code===cc)?.name} · ${district}`}
          title="月度趨勢"
          right={<span className="text-xs text-ink-500">中位＋成交量</span>}
        >
          <div className="h-[320px]">
            {monthly.length ? (
              <ResponsiveContainer>
                <ComposedChart data={monthly.map(m => ({
                  ...m,
                  median_wan: m.median_unit_price_ping ? m.median_unit_price_ping / 10000 : null,
                }))} margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#e7e5e4" vertical={false} />
                  <XAxis dataKey="month" stroke="#a8a29e" tickFormatter={(s)=>s.slice(0,7)} />
                  <YAxis yAxisId="left" stroke="#a8a29e" />
                  <YAxis yAxisId="right" orientation="right" stroke="#a8a29e" />
                  <Tooltip
                    contentStyle={{ background: "#1c1917", border: "none", color: "#fafaf9", fontSize: 12, borderRadius: 6 }}
                    formatter={(v: any, k: string) =>
                      k === "median_wan" ? [`${(+v).toFixed(1)} 萬/坪`, "中位"] : [fmt(+v), "成交"]
                    }
                  />
                  <Bar yAxisId="right" dataKey="deals" fill="#e7e5e4" />
                  <Line yAxisId="left" type="monotone" dataKey="median_wan" stroke="#1d4ed8" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-ink-400">該鄉鎮在篩選範圍內無資料</div>
            )}
          </div>
        </Section>
      )}

      {/* 鄉鎮排行 */}
      <Section
        kicker="逐鄉鎮"
        title="排行（中位 萬/坪）"
        right={<span className="text-xs text-ink-500">點選鄉鎮看月度趨勢</span>}
      >
        <div className="overflow-x-auto">
          <table className="table-clean w-full">
            <thead>
              <tr>
                <th>排名</th>
                <th>鄉鎮市區</th>
                <th className="text-right">中位 萬/坪</th>
                <th className="text-right">均價 萬/坪</th>
                <th className="text-right">中位總價 (萬)</th>
                <th className="text-right">近 12 月成交</th>
              </tr>
            </thead>
            <tbody>
              {heatmap.map((r, i) => (
                <tr key={r.district}
                    className={`cursor-pointer ${district === r.district ? "bg-accent/5" : ""}`}
                    onClick={() => setQ({ district: r.district })}>
                  <td className="stat-num text-ink-500">{i + 1}</td>
                  <td className="font-medium text-ink-900">{r.district}</td>
                  <td className="text-right stat-num">{fmtPing(r.median_unit_price_ping)}</td>
                  <td className="text-right stat-num text-ink-500">{fmtPing(r.avg_unit_price_ping)}</td>
                  <td className="text-right stat-num">{fmtWan(r.median_total_price)}</td>
                  <td className="text-right stat-num text-ink-500">{fmt(r.deals)}</td>
                </tr>
              ))}
              {!heatmap.length && (
                <tr><td colSpan={6} className="py-10 text-center text-ink-400">無資料 — 跑過 pipeline 了嗎？</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      {/* 動能 */}
      <Section
        kicker="近 6 月 vs 前 6 月"
        title="價格動能"
        right={<span className="text-xs text-ink-500">綠 = 漲 ／ 紅 = 跌</span>}
      >
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
          {momentum.filter(m => m.pct_change != null).slice(0, 18).map((m) => (
            <div key={m.district}
                 className="flex items-baseline justify-between rounded-md border border-ink-200 bg-white px-3 py-2 text-sm">
              <span className="text-ink-700">{m.district}</span>
              <span className={`stat-num ${m.pct_change && m.pct_change > 0 ? "text-up" : "text-down"}`}>
                {fmtPct(m.pct_change)}
              </span>
            </div>
          ))}
          {!momentum.length && <div className="text-sm text-ink-400">無資料</div>}
        </div>
      </Section>

      {/* 建物型態比較 */}
      {bldgTypes.length > 0 && (
        <Section
          kicker="近 12 月"
          title="建物型態比較"
          right={<span className="text-xs text-ink-500">公寓 / 華廈 / 大樓 / 透天，誰是 CP 之王？</span>}
        >
          <div className="overflow-x-auto">
            <table className="table-clean w-full">
              <thead>
                <tr>
                  <th>型態</th>
                  <th className="text-right">成交數</th>
                  <th className="text-right">中位 萬/坪</th>
                  <th className="text-right">中位總價 (萬)</th>
                  <th className="text-right">平均坪數</th>
                  <th className="text-right">平均屋齡</th>
                </tr>
              </thead>
              <tbody>
                {bldgTypes.slice(0, 12).map(r => (
                  <tr key={r.building_type}>
                    <td className="font-medium text-ink-900">{r.building_type}</td>
                    <td className="text-right stat-num text-ink-500">{fmt(r.deals)}</td>
                    <td className="text-right stat-num">{fmtPing(r.median_unit_price_ping)}</td>
                    <td className="text-right stat-num">{fmtWan(r.median_total_price)}</td>
                    <td className="text-right stat-num text-ink-500">
                      {r.avg_building_area_sqm ? (r.avg_building_area_sqm / 3.305785).toFixed(1) : "—"}
                    </td>
                    <td className="text-right stat-num text-ink-500">
                      {r.avg_age_years != null ? r.avg_age_years.toFixed(1) + " 年" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* 屋齡 vs 中位單價 */}
      {ageBuckets.length > 0 && dk === "sale" && (
        <Section
          kicker="近 12 月 · 不動產買賣"
          title="屋齡對價格的影響"
          right={<span className="text-xs text-ink-500">折線＝中位單價</span>}
        >
          <div className="h-[260px]">
            <ResponsiveContainer>
              <ComposedChart data={ageBuckets.map(b => ({
                bucket: b.bucket,
                median_wan: b.median_unit_price_ping ? b.median_unit_price_ping / 10000 : null,
                deals: b.deals,
              }))} margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#e7e5e4" vertical={false} />
                <XAxis dataKey="bucket" stroke="#a8a29e" />
                <YAxis yAxisId="left" stroke="#a8a29e" />
                <YAxis yAxisId="right" orientation="right" stroke="#a8a29e" />
                <Tooltip
                  contentStyle={{ background: "#1c1917", border: "none", color: "#fafaf9", fontSize: 12, borderRadius: 6 }}
                  formatter={(v: any, k: string) =>
                    k === "median_wan" ? [`${(+v).toFixed(1)} 萬/坪`, "中位"] : [fmt(+v), "成交數"]
                  }
                />
                <Bar yAxisId="right" dataKey="deals" fill="#e7e5e4" />
                <Line yAxisId="left" type="monotone" dataKey="median_wan" stroke="#1d4ed8" strokeWidth={2} dot />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Section>
      )}

      {/* 坪數 vs 中位總價 */}
      {sizeBuckets.length > 0 && dk === "sale" && (
        <Section
          kicker="近 12 月 · 不動產買賣"
          title="坪數對應總價（買多大要花多少）"
          right={<span className="text-xs text-ink-500">這是最直覺的「我能買得起什麼」</span>}
        >
          <div className="overflow-x-auto">
            <table className="table-clean w-full">
              <thead>
                <tr>
                  <th>坪數</th>
                  <th className="text-right">成交數</th>
                  <th className="text-right">中位總價 (萬)</th>
                  <th className="text-right">中位 萬/坪</th>
                  <th className="text-right">平均屋齡</th>
                </tr>
              </thead>
              <tbody>
                {sizeBuckets.map(r => (
                  <tr key={r.bucket}>
                    <td className="font-medium text-ink-900">{r.bucket}</td>
                    <td className="text-right stat-num text-ink-500">{fmt(r.deals)}</td>
                    <td className="text-right stat-num">{fmtWan(r.median_total_price)}</td>
                    <td className="text-right stat-num text-ink-500">{fmtPing(r.median_unit_price_ping)}</td>
                    <td className="text-right stat-num text-ink-500">
                      {r.avg_age_years != null ? r.avg_age_years.toFixed(1) + " 年" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* 分位 */}
      {dist && (
        <Section kicker="近 12 月" title="價位分位（萬/坪）">
          <div className="grid gap-4 md:grid-cols-5">
            <Kpi label="P10" value={fmtPing(dist.stats.p10)} />
            <Kpi label="P25" value={fmtPing(dist.stats.p25)} />
            <Kpi label="中位 P50" value={fmtPing(dist.stats.p50)} accent="default" />
            <Kpi label="P75" value={fmtPing(dist.stats.p75)} />
            <Kpi label="P90" value={fmtPing(dist.stats.p90)} />
          </div>
          <div className="mt-4 h-[200px]">
            <ResponsiveContainer>
              <ComposedChart data={dist.bins.map(b => ({
                lo: b.lo / 10000,
                n: b.n,
              }))}>
                <CartesianGrid stroke="#e7e5e4" vertical={false} />
                <XAxis dataKey="lo" tickFormatter={(v)=>`${v}`} stroke="#a8a29e" />
                <YAxis stroke="#a8a29e" />
                <Tooltip
                  contentStyle={{ background: "#1c1917", border: "none", color: "#fafaf9", fontSize: 12, borderRadius: 6 }}
                  formatter={(v: any, _k, p: any) => [`${fmt(+v)} 筆`, `${p.payload.lo}~${p.payload.lo+10} 萬/坪`]}
                />
                <Bar dataKey="n" fill="#1d4ed8" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Section>
      )}
    </div>
  );
}
