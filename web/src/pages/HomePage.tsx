import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell,
} from "recharts";
import { data, type CountySummary, type DealKind, type Meta } from "../lib/data";
import { fmt, fmtPing, fmtWan } from "../lib/format";
import { KpiBar, Kpi } from "../components/KpiBar";
import DealKindTabs from "../components/DealKindTabs";
import Section from "../components/Section";

export default function HomePage({ meta }: { meta: Meta | null }) {
  const [dk, setDk] = useState<DealKind>("sale");
  const [summary, setSummary] = useState<Record<DealKind, CountySummary[]> | null>(null);

  useEffect(() => {
    data.countySummary().then(setSummary).catch(() => {});
  }, []);

  const rows = summary?.[dk] ?? [];
  const totalDeals = rows.reduce((s, r) => s + (r.total_deals ?? 0), 0);
  const medianAvg = useMemo(() => {
    const xs = rows.map(r => r.median_unit_price_ping ?? 0).filter(Boolean);
    if (!xs.length) return null;
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  }, [rows]);

  const top = rows[0];
  const bottom = rows[rows.length - 1];

  return (
    <div className="space-y-8">
      {/* —— Lead —— */}
      <section className="panel">
        <div className="grid grid-cols-1 gap-6 p-8 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <div className="label">Issue · {meta?.generated_at?.slice(0, 10) ?? "—"}</div>
            <h1 className="mt-3 font-serif text-4xl leading-tight text-ink-900 lg:text-5xl">
              台灣全 22 縣市不動產的<br/>
              <span className="text-accent">公開成交數據</span>，<br/>
              在這個瀏覽器裡跑。
            </h1>
            <p className="mt-4 max-w-xl text-[15px] leading-7 text-ink-600">
              所有資料來自內政部實價登錄 Open Data，每旬公告即更新。
              本站把全部聚合預先烘成靜態檔，
              查詢以 CDN 速度回應，不依賴任何後端。
            </p>
            <div className="mt-6 flex gap-2">
              <Link to="/region" className="btn btn-active">縣市深掘 →</Link>
              <Link to="/browse" className="btn">看最新成交</Link>
            </div>
          </div>

          {/* 邊欄報頭資訊 */}
          <div className="rounded-md border border-ink-200 bg-ink-50 p-5">
            <div className="label mb-3">本期摘要</div>
            <dl className="space-y-3 text-sm">
              <Item k="覆蓋縣市" v={`${meta?.counties.length ?? 6} 個`} />
              <Item k="買賣最新成交日" v={meta?.last_deal_date?.sale ?? "—"} mono />
              <Item k="預售最新成交日" v={meta?.last_deal_date?.presale ?? "—"} mono />
              <Item k="租賃最新成交日" v={meta?.last_deal_date?.rent ?? "—"} mono />
              <Item k="資料烘製時間" v={meta?.generated_at?.replace("T", " ") ?? "—"} mono />
            </dl>
          </div>
        </div>
      </section>

      {/* —— 全景 KPI —— */}
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-2xl text-ink-900">全台全景</h2>
        <DealKindTabs value={dk} onChange={setDk} />
      </div>

      <KpiBar>
        <Kpi label="總成交筆數" value={fmt(totalDeals)} sub="近年累積" />
        <Kpi label="全台中位均價"
             value={medianAvg ? `${fmtPing(medianAvg)} 萬/坪` : "—"}
             sub="各縣市中位之平均" />
        <Kpi
          label="最高均價"
          value={top ? `${fmtPing(top.median_unit_price_ping)} 萬/坪` : "—"}
          sub={top?.county_name}
        />
        <Kpi
          label="最低均價"
          value={bottom ? `${fmtPing(bottom.median_unit_price_ping)} 萬/坪` : "—"}
          sub={bottom?.county_name}
        />
      </KpiBar>

      {/* —— 排行條形圖 —— */}
      <Section
        kicker="全台比較"
        title="中位單價（萬/坪）"
        right={<span className="text-xs text-ink-500">深色＝高，淺色＝低</span>}
      >
        <div className="h-[280px]">
          <ResponsiveContainer>
            <BarChart
              data={rows.map(r => ({
                name: r.county_name?.replace("市", "") ?? r.county_code,
                median: r.median_unit_price_ping ? r.median_unit_price_ping / 10000 : 0,
                deals: r.total_deals,
              }))}
              margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
            >
              <XAxis dataKey="name" stroke="#a8a29e" tickLine={false} axisLine={false} />
              <YAxis stroke="#a8a29e" tickLine={false} axisLine={false} width={40} />
              <Tooltip
                contentStyle={{
                  background: "#1c1917", border: "none",
                  fontSize: 12, color: "#fafaf9", borderRadius: 6,
                }}
                formatter={(v: any) => [`${(+v).toFixed(1)} 萬/坪`, "中位"]}
              />
              <Bar dataKey="median" radius={[4, 4, 0, 0]}>
                {rows.map((_, i) => {
                  const t = rows.length > 1 ? i / (rows.length - 1) : 0;
                  // 從 ink-900 → ink-400
                  const lightness = 28 + t * 50;
                  return (
                    <Cell key={i} fill={`hsl(20, 6%, ${lightness}%)`} />
                  );
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Section>

      {/* —— 縣市詳表 —— */}
      <Section kicker="逐縣市" title="全景數據表">
        <div className="overflow-x-auto">
          <table className="table-clean w-full">
            <thead>
              <tr>
                <th>縣市</th>
                <th className="text-right">成交筆數</th>
                <th className="text-right">中位 萬/坪</th>
                <th className="text-right">均價 萬/坪</th>
                <th className="text-right">中位總價 (萬)</th>
                <th className="text-right">最後成交日</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.county_code}>
                  <td className="font-medium text-ink-900">{r.county_name}</td>
                  <td className="text-right stat-num">{fmt(r.total_deals)}</td>
                  <td className="text-right stat-num">{fmtPing(r.median_unit_price_ping)}</td>
                  <td className="text-right stat-num text-ink-500">{fmtPing(r.avg_unit_price_ping)}</td>
                  <td className="text-right stat-num">{fmtWan(r.median_total_price)}</td>
                  <td className="text-right stat-num text-ink-500">{r.last_deal_date ?? "—"}</td>
                  <td className="text-right">
                    <Link to={`/region?county=${r.county_code}&dk=${dk}`}
                          className="text-xs text-accent hover:underline">深掘 →</Link>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={7} className="py-10 text-center text-ink-400">資料載入中或尚無資料</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function Item({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between border-b border-dotted border-ink-200 pb-2">
      <dt className="text-ink-500">{k}</dt>
      <dd className={mono ? "stat-num text-ink-900" : "text-ink-900"}>{v}</dd>
    </div>
  );
}
