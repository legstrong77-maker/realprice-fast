import { useEffect, useMemo, useState } from "react";
import { data, type Meta, type UnderpricedRow } from "../lib/data";
import { fmt, fmtPing, fmtWan, fmtDate, fmtPct } from "../lib/format";
import Section from "../components/Section";
import { Kpi, KpiBar } from "../components/KpiBar";

export default function UnderpricedPage({ meta }: { meta: Meta | null }) {
  const counties = meta?.counties ?? [];
  const [cc, setCc] = useState("a");
  const [district, setDistrict] = useState("");
  const [rows, setRows] = useState<UnderpricedRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    data.underpriced(cc).then(rs => { setRows(rs); setLoading(false); }).catch(() => { setRows([]); setLoading(false); });
    setDistrict("");
  }, [cc]);

  const districts = useMemo(
    () => Array.from(new Set(rows.map(r => r.district))).sort(),
    [rows]
  );
  const filtered = district ? rows.filter(r => r.district === district) : rows;

  const stats = useMemo(() => {
    if (!filtered.length) return null;
    const ratios = filtered.map(r => r.price_ratio);
    return {
      n: filtered.length,
      bestRatio: Math.min(...ratios),
      avgRatio: ratios.reduce((a, b) => a + b, 0) / ratios.length,
      totalDiscount: filtered.reduce((sum, r) => sum + (r.region_p25 - r.unit_price_per_ping!) * (r.building_area_sqm! / 3.305785), 0),
    };
  }, [filtered]);

  return (
    <div className="space-y-6">
      <section className="panel p-8 bg-gradient-to-br from-amber-50/50 to-white">
        <div className="label">CP 雷達</div>
        <h1 className="mt-2 font-serif text-3xl text-ink-900">撿漏雷達 🎯</h1>
        <p className="mt-3 max-w-2xl text-ink-600 leading-7">
          列出近 6 個月成交中、單價<strong>低於同區同類別 P25 的 85%</strong> 以下的物件。
          這些可能是議價厲害、急售、屋況差，或是真的撿到便宜 — 看看哪些值得追蹤觀察。
        </p>
      </section>

      <div className="panel flex flex-wrap items-center gap-3 p-4">
        <select className="input max-w-[160px]"
                value={cc}
                onChange={e => setCc(e.target.value)}>
          {counties.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
        <select className="input max-w-[200px]"
                value={district}
                onChange={e => setDistrict(e.target.value)}>
          <option value="">— 全部鄉鎮 —</option>
          {districts.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <span className="text-xs text-ink-500 ml-auto">
          {loading ? "載入中..." : `共 ${fmt(filtered.length)} 筆撿漏`}
        </span>
      </div>

      {stats && (
        <KpiBar>
          <Kpi label="撿漏物件數" value={fmt(stats.n)} sub="近 6 月成交" />
          <Kpi label="最大折扣"
               value={`${((1 - stats.bestRatio) * 100).toFixed(1)}%`}
               sub="低於同區 P25"
               accent="up" />
          <Kpi label="平均折扣"
               value={`${((1 - stats.avgRatio) * 100).toFixed(1)}%`}
               sub="低於同區 P25" />
          <Kpi label="總『撿到便宜』"
               value={`${fmtWan(stats.totalDiscount)} 萬`}
               sub="與 P25 對比" />
        </KpiBar>
      )}

      <Section kicker="近 6 月" title="撿漏排行（折扣大→小）">
        <div className="overflow-x-auto">
          <table className="table-clean w-full">
            <thead>
              <tr>
                <th>成交日</th>
                <th>鄉鎮</th>
                <th>地址</th>
                <th>類型</th>
                <th className="text-right">坪數</th>
                <th className="text-right">屋齡</th>
                <th className="text-right">萬/坪</th>
                <th className="text-right">同區 P25</th>
                <th className="text-right">折扣</th>
                <th className="text-right">總價(萬)</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const discount = 1 - r.price_ratio;
                return (
                  <tr key={r.serial_no}>
                    <td className="stat-num text-ink-500">{fmtDate(r.deal_date)}</td>
                    <td className="text-ink-700">{r.district}</td>
                    <td className="text-ink-900 max-w-[260px] truncate" title={r.address ?? ""}>{r.address ?? "—"}</td>
                    <td className="text-ink-500 text-xs">{r.building_type ?? "—"}</td>
                    <td className="text-right stat-num">
                      {r.building_area_sqm ? (r.building_area_sqm / 3.305785).toFixed(1) : "—"}
                    </td>
                    <td className="text-right stat-num text-ink-500">
                      {r.age_years != null ? `${r.age_years}年` : "—"}
                    </td>
                    <td className="text-right stat-num font-medium">{fmtPing(r.unit_price_per_ping)}</td>
                    <td className="text-right stat-num text-ink-500">{fmtPing(r.region_p25)}</td>
                    <td className="text-right stat-num text-up font-semibold">
                      -{(discount * 100).toFixed(1)}%
                    </td>
                    <td className="text-right stat-num">{fmtWan(r.total_price)}</td>
                  </tr>
                );
              })}
              {!filtered.length && !loading && (
                <tr><td colSpan={10} className="py-10 text-center text-ink-400">該縣市無撿漏資料 — 表示市場很穩定，沒有明顯偏低成交</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <Section kicker="這份名單怎麼讀" title="使用須知">
        <ul className="text-sm leading-7 text-ink-700 list-disc pl-5">
          <li>「折扣 -X%」= 該成交單價比同鄉鎮同類型 P25 還低 X%</li>
          <li>**便宜不一定就是好** — 可能屋況差、樓層差（地下室、頂樓加蓋）、有違建、漏水</li>
          <li>本表已排除特殊註記交易（凶宅 / 急售 / 親友等）— 若仍見到極端低價，多半屋況因素</li>
          <li>沒看到你的鄉鎮？— 可能該區成交太少（&lt; 10 筆同類型）導致 P25 統計無效</li>
          <li>看到喜歡的，記下「鄰近成交」+「同社區成交」再做決策</li>
        </ul>
      </Section>
    </div>
  );
}
