import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid,
  ComposedChart, Bar,
} from "recharts";
import {
  data, type DealKind, type HeatmapRow, type Meta, type MomentumRow,
  type MonthlyRow, type DistributionPayload,
  type BuildingTypeRow, type AgeBucketRow, type SizeBucketRow, type SpreadRow,
} from "../lib/data";
import { fmt, fmtPct, fmtPing, fmtWan } from "../lib/format";
import { Kpi, KpiBar } from "../components/KpiBar";
import DealKindTabs from "../components/DealKindTabs";
import Section from "../components/Section";
import { addShortlist, isShortlisted } from "../lib/shortlist";
import { buildAreaNarrative } from "../lib/analysis";

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
  const [spread, setSpread] = useState<SpreadRow[]>([]);
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
    data.spread(cc).then(setSpread).catch(() => setSpread([]));
  }, [cc]);

  const spreadSel = district ? spread.find(r => r.district === district) ?? null : null;

  // 鄉鎮選擇 / 重置時抓月度
  useEffect(() => {
    if (!district) { setMonthly([]); return; }
    data.monthly(cc, district, dk)
      .then(setMonthly)
      .catch((e) => { setErr(String(e)); setMonthly([]); });
  }, [cc, district, dk]);

  const counties = meta?.counties ?? [];
  const districts = meta?.districts?.[cc] ?? [];
  const countyName = counties.find(c => c.code === cc)?.name ?? cc;

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
  const selectedHeat = district ? heatmap.find(r => r.district === district) : null;
  const selectedMomentum = district ? momentum.find(r => r.district === district) : null;

  const districtSignals = useMemo(() => {
    if (!heatmap.length) return [];
    const momByDistrict = new Map(momentum.map(m => [m.district, m]));
    const city = cityMedian ?? 0;
    return heatmap.map((h) => {
      const m = momByDistrict.get(h.district);
      const priceRatio = city && h.median_unit_price_ping ? h.median_unit_price_ping / city : null;
      const liquidityScore = Math.min((h.deals ?? 0) / 160, 1) * 35;
      const valueScore = priceRatio == null ? 10 : priceRatio < 0.85 ? 32 : priceRatio < 1 ? 24 : priceRatio < 1.18 ? 14 : 6;
      const momentumScore = m?.pct_change == null ? 10 : m.pct_change > 0.15 ? 6 : m.pct_change > 0 ? 18 : m.pct_change > -0.12 ? 22 : 10;
      const score = liquidityScore + valueScore + momentumScore;
      const warning =
        (h.deals ?? 0) < 30 ? "樣本偏少" :
        m?.pct_change != null && m.pct_change > 0.15 ? "短期漲幅偏快" :
        m?.pct_change != null && m.pct_change < -0.12 ? "價格回落，需查原因" :
        priceRatio != null && priceRatio > 1.25 ? "價格高於縣市均衡" :
        "條件相對穩定";
      return { ...h, momentum: m?.pct_change ?? null, priceRatio, score, warning };
    }).sort((a, b) => b.score - a.score);
  }, [heatmap, momentum, cityMedian]);

  const selectedAdvice = useMemo(() => {
    if (!selectedHeat) return null;
    const notes: string[] = [];
    if ((selectedHeat.deals ?? 0) < 30) notes.push("近 12 月成交低於 30 筆，價格代表性偏弱。");
    else if ((selectedHeat.deals ?? 0) >= 120) notes.push("成交量充足，較容易找到可比案例。");
    if (selectedMomentum?.pct_change != null && selectedMomentum.pct_change > 0.15) {
      notes.push("近半年漲幅偏快，追價前要確認是否為新案或特殊物件拉高。");
    } else if (selectedMomentum?.pct_change != null && selectedMomentum.pct_change < -0.12) {
      notes.push("近半年價格回落，適合議價，但要檢查供給、屋況或區域利空。");
    } else if (selectedMomentum?.pct_change != null) {
      notes.push("近半年價格變動溫和，較適合用 P25/P50/P75 做出價基準。");
    }
    if (cityMedian && selectedHeat.median_unit_price_ping) {
      const ratio = selectedHeat.median_unit_price_ping / cityMedian;
      if (ratio > 1.2) notes.push("單價明顯高於縣市平均，應要求地段、學區、屋況或交通條件支撐。");
      if (ratio < 0.9) notes.push("單價低於縣市平均，可列入預算友善候選，但要看通勤與生活機能。");
    }
    return notes;
  }, [selectedHeat, selectedMomentum, cityMedian]);
  const narrative = selectedHeat ? buildAreaNarrative({
    row: selectedHeat,
    momentum: selectedMomentum ?? undefined,
    countyMedian: cityMedian,
  }) : null;

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

      <Section
        kicker="買房判斷"
        title={district ? `${district} 區域提醒` : "自住友善候選區"}
        right={<span className="text-xs text-ink-500">價格、成交量、短期動能綜合排序</span>}
      >
        {district && selectedHeat ? (
          <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-1">
              <MiniSignal label="近 12 月成交" value={`${fmt(selectedHeat.deals)} 筆`} />
              <MiniSignal label="中位單價" value={`${fmtPing(selectedHeat.median_unit_price_ping)} 萬/坪`} />
              <MiniSignal label="近半年動能" value={fmtPct(selectedMomentum?.pct_change)} tone={(selectedMomentum?.pct_change ?? 0) > 0 ? "up" : "down"} />
              {spreadSel?.spread_pct != null && (
                <MiniSignal
                  label={`議價空間${spreadSel.method === "scrape" ? "（實抓開價）" : ""}`}
                  value={`${(spreadSel.spread_pct * 100).toFixed(1)}%`}
                  tone="default"
                />
              )}
            </div>
            <div className="rounded-md border border-ink-200 bg-ink-50 p-4">
              <div className="label mb-3">看屋前先確認</div>
              <ul className="space-y-2 text-sm leading-6 text-ink-700">
                {(selectedAdvice ?? []).map((note) => <li key={note}>{note}</li>)}
              </ul>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {districtSignals.slice(0, 8).map((r) => (
              <button
                key={r.district}
                onClick={() => setQ({ district: r.district })}
                className="rounded-md border border-ink-200 bg-white p-4 text-left transition hover:border-accent hover:bg-accent/5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-serif text-lg text-ink-900">{r.district}</div>
                  <div className="stat-num text-sm text-accent">{r.score.toFixed(0)}</div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-ink-500">
                  <span>中位 {fmtPing(r.median_unit_price_ping)} 萬/坪</span>
                  <span className="text-right">{fmt(r.deals)} 筆</span>
                  <span className={(r.momentum ?? 0) > 0 ? "text-up" : "text-down"}>{fmtPct(r.momentum)}</span>
                  <span className="text-right text-ink-700">{r.warning}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </Section>

      {district && narrative && (
        <Section
          kicker="區域摘要"
          title={narrative.headline}
          right={<span className={`pill ${narrative.confidence === "高" ? "text-up" : narrative.confidence === "低" ? "text-down" : ""}`}>可信度 {narrative.confidence}</span>}
        >
          <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="grid gap-3 md:grid-cols-2">
              {narrative.signals.map((s) => (
                <MiniSignal key={s.label} label={s.label} value={s.value} tone={s.tone ?? "default"} />
              ))}
            </div>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-1">
              <div className="rounded-md border border-ink-200 bg-emerald-50 p-4">
                <div className="label mb-2 text-up">可利用的優勢</div>
                {narrative.notes.length ? (
                  <ul className="space-y-1.5 text-sm leading-6 text-ink-700">
                    {narrative.notes.map(n => <li key={n}>{n}</li>)}
                  </ul>
                ) : <div className="text-sm text-ink-500">沒有明顯優勢訊號，建議回到個案條件判斷。</div>}
              </div>
              <div className="rounded-md border border-ink-200 bg-rose-50 p-4">
                <div className="label mb-2 text-down">需要查證的風險</div>
                {narrative.warnings.length ? (
                  <ul className="space-y-1.5 text-sm leading-6 text-ink-700">
                    {narrative.warnings.map(w => <li key={w}>{w}</li>)}
                  </ul>
                ) : <div className="text-sm text-ink-500">目前沒有明顯資料警訊。</div>}
              </div>
            </div>
          </div>
        </Section>
      )}

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
                  <CartesianGrid stroke="#e3dac8" vertical={false} />
                  <XAxis dataKey="month" stroke="#a99e86" tickFormatter={(s)=>s.slice(0,7)} />
                  <YAxis yAxisId="left" stroke="#a99e86" />
                  <YAxis yAxisId="right" orientation="right" stroke="#a99e86" />
                  <Tooltip
                    contentStyle={{ background: "#1c1813", border: "none", color: "#f8f4ec", fontSize: 12, borderRadius: 6 }}
                    formatter={(v: any, k: string) =>
                      k === "median_wan" ? [`${(+v).toFixed(1)} 萬/坪`, "中位"] : [fmt(+v), "成交"]
                    }
                  />
                  <Bar yAxisId="right" dataKey="deals" fill="#e3dac8" />
                  <Line yAxisId="left" type="monotone" dataKey="median_wan" stroke="#b8862c" strokeWidth={2} dot={false} />
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
                <th></th>
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
                  <td className="text-right">
                    <button
                      className="text-xs text-accent hover:underline disabled:text-ink-400 disabled:no-underline"
                      disabled={isShortlisted(cc, r.district)}
                      onClick={(e) => {
                        e.stopPropagation();
                        addShortlist({ county: cc, countyName, district: r.district, source: "region" });
                      }}
                    >
                      {isShortlisted(cc, r.district) ? "已加入" : "加入比較"}
                    </button>
                  </td>
                </tr>
              ))}
              {!heatmap.length && (
                <tr><td colSpan={7} className="py-10 text-center text-ink-400">無資料 — 跑過 pipeline 了嗎？</td></tr>
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
                <CartesianGrid stroke="#e3dac8" vertical={false} />
                <XAxis dataKey="bucket" stroke="#a99e86" />
                <YAxis yAxisId="left" stroke="#a99e86" />
                <YAxis yAxisId="right" orientation="right" stroke="#a99e86" />
                <Tooltip
                  contentStyle={{ background: "#1c1813", border: "none", color: "#f8f4ec", fontSize: 12, borderRadius: 6 }}
                  formatter={(v: any, k: string) =>
                    k === "median_wan" ? [`${(+v).toFixed(1)} 萬/坪`, "中位"] : [fmt(+v), "成交數"]
                  }
                />
                <Bar yAxisId="right" dataKey="deals" fill="#e3dac8" />
                <Line yAxisId="left" type="monotone" dataKey="median_wan" stroke="#b8862c" strokeWidth={2} dot />
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
                <CartesianGrid stroke="#e3dac8" vertical={false} />
                <XAxis dataKey="lo" tickFormatter={(v)=>`${v}`} stroke="#a99e86" />
                <YAxis stroke="#a99e86" />
                <Tooltip
                  contentStyle={{ background: "#1c1813", border: "none", color: "#f8f4ec", fontSize: 12, borderRadius: 6 }}
                  formatter={(v: any, _k, p: any) => [`${fmt(+v)} 筆`, `${p.payload.lo}~${p.payload.lo+10} 萬/坪`]}
                />
                <Bar dataKey="n" fill="#b8862c" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Section>
      )}
    </div>
  );
}

function MiniSignal({ label, value, tone = "default" }: { label: string; value: string; tone?: "up" | "down" | "default" }) {
  const color = tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-ink-900";
  return (
    <div className="rounded-md border border-ink-200 bg-white p-4">
      <div className="label">{label}</div>
      <div className={`mt-1 stat-num text-xl ${color}`}>{value}</div>
    </div>
  );
}
