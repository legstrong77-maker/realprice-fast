import { useEffect, useMemo, useState } from "react";
import { data, type CountySummary, type HeatmapRow, type Meta } from "../lib/data";
import { fmt, fmtPing } from "../lib/format";
import Section from "../components/Section";
import { Kpi, KpiBar } from "../components/KpiBar";
import RoleHero from "../components/RoleHero";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

/** 租金投報率 = 年租金 / 房價。
 *  rent heatmap 的 median_unit_price_ping = 月租金/坪；
 *  sale heatmap 的 median_unit_price_ping = 成交單價/坪。
 *  年化投報 = (月租/坪 × 12) / (單價/坪)。坪數在分子分母約分掉，與面積無關。
 */
function yieldPct(saleUnitPing: number | null, rentUnitPing: number | null): number | null {
  if (!saleUnitPing || !rentUnitPing || saleUnitPing <= 0) return null;
  return (rentUnitPing * 12) / saleUnitPing;
}

/** 投報率分級（自住/收租參考，非投資建議）。 */
function yieldTone(y: number | null): { label: string; tone: string } {
  if (y == null) return { label: "—", tone: "text-ink-400" };
  const p = y * 100;
  if (p >= 4) return { label: "收租優", tone: "text-up" };
  if (p >= 3) return { label: "尚可", tone: "text-ink-900" };
  if (p >= 2) return { label: "偏低", tone: "text-amber-700" };
  return { label: "極低", tone: "text-down" };
}

export default function YieldPage({ meta }: { meta: Meta | null }) {
  const counties = meta?.counties ?? [];
  const [cc, setCc] = useState("a");
  const [summary, setSummary] = useState<Record<string, CountySummary[]> | null>(null);
  const [saleHeat, setSaleHeat] = useState<HeatmapRow[]>([]);
  const [rentHeat, setRentHeat] = useState<HeatmapRow[]>([]);

  useEffect(() => { data.countySummary().then(setSummary).catch(() => setSummary(null)); }, []);
  useEffect(() => {
    data.heatmap(cc, "sale").then(setSaleHeat).catch(() => setSaleHeat([]));
    data.heatmap(cc, "rent").then(setRentHeat).catch(() => setRentHeat([]));
  }, [cc]);

  // ── 全台縣市投報率排行（join county-summary sale × rent）
  const countyYields = useMemo(() => {
    if (!summary) return [];
    const sale = summary["sale"] ?? [];
    const rent = summary["rent"] ?? [];
    const rentByCode = new Map(rent.map(r => [r.county_code, r]));
    return sale
      .map(s => {
        const r = rentByCode.get(s.county_code);
        const y = yieldPct(s.median_unit_price_ping, r?.median_unit_price_ping ?? null);
        return {
          code: s.county_code,
          name: s.county_name,
          saleP: s.median_unit_price_ping,
          rentP: r?.median_unit_price_ping ?? null,
          y,
        };
      })
      .filter(d => d.y != null)
      .sort((a, b) => (b.y! - a.y!));
  }, [summary]);

  // ── 選定縣市的鄉鎮投報率（join heatmap sale × rent by district）
  const districtYields = useMemo(() => {
    const rentByDist = new Map(rentHeat.map(r => [r.district, r]));
    return saleHeat
      .map(s => {
        const r = rentByDist.get(s.district);
        const y = yieldPct(s.median_unit_price_ping, r?.median_unit_price_ping ?? null);
        return {
          district: s.district,
          saleP: s.median_unit_price_ping,
          rentP: r?.median_unit_price_ping ?? null,
          saleDeals: s.deals,
          rentDeals: r?.deals ?? 0,
          y,
        };
      })
      .filter(d => d.y != null && d.rentDeals >= 10 && d.saleDeals >= 10)
      .sort((a, b) => (b.y! - a.y!));
  }, [saleHeat, rentHeat]);

  const ccName = counties.find(c => c.code === cc)?.name ?? cc;
  const bestCounty = countyYields[0];
  const worstCounty = countyYields[countyYields.length - 1];
  const bestDist = districtYields[0];
  const ccYield = countyYields.find(d => d.code === cc)?.y ?? null;

  return (
    <div className="space-y-6">
      <RoleHero kicker="Investor's Lab · 包租公雷達" title="租金投報率：買來收租划算嗎？" img="/img/accent-invest.webp">
        把<strong>同一地區的租賃成交</strong>和<strong>買賣成交</strong>放在一起算：
        <span className="stat-num"> 年化投報率 = 年租金 ÷ 房價</span>。
        這是市面上其他實價登錄站少見的視角 —— 因為要同時有租、售兩邊的成交資料。
        數字越高代表「買來收租」的現金流回報越好；但高投報常伴隨增值性偏弱，請搭配房價趨勢一起看。
      </RoleHero>

      {/* 全台縣市排行 */}
      <Section kicker="全台 22 縣市" title="哪個縣市收租回報最高？">
        <KpiBar>
          <Kpi label="投報最高縣市" value={bestCounty ? bestCounty.name : "—"}
               sub={bestCounty ? `年化約 ${(bestCounty.y! * 100).toFixed(2)}%` : ""} accent="up" />
          <Kpi label="投報最低縣市" value={worstCounty ? worstCounty.name : "—"}
               sub={worstCounty ? `年化約 ${(worstCounty.y! * 100).toFixed(2)}%` : ""} accent="down" />
          <Kpi label={`${ccName} 投報`} value={ccYield != null ? `${(ccYield * 100).toFixed(2)}%` : "—"}
               sub="目前選定縣市（中位）" />
          <Kpi label="全台中位投報"
               value={countyYields.length ? `${(median(countyYields.map(d => d.y!)) * 100).toFixed(2)}%` : "—"}
               sub="22 縣市中位數" />
        </KpiBar>

        <div className="mt-6 h-[460px]">
          <ResponsiveContainer>
            <BarChart data={countyYields.map(d => ({ name: d.name, 投報: +(d.y! * 100).toFixed(2), code: d.code }))}
                      layout="vertical" margin={{ top: 4, right: 40, left: 8, bottom: 4 }}>
              <CartesianGrid stroke="#e3dac8" horizontal={false} />
              <XAxis type="number" stroke="#a99e86" tickFormatter={(v) => `${v}%`} />
              <YAxis type="category" dataKey="name" stroke="#a99e86" width={56} tick={{ fontSize: 12 }} />
              <Tooltip
                contentStyle={{ background: "#1c1813", border: "none", color: "#f8f4ec", fontSize: 12, borderRadius: 6 }}
                formatter={(v: any) => [`${v}%`, "年化投報"]}
              />
              <Bar dataKey="投報" radius={[0, 3, 3, 0]}>
                {countyYields.map((d) => (
                  <Cell key={d.code} fill={d.code === cc ? "#b8862c" : "#a99e86"}
                        cursor="pointer" onClick={() => setCc(d.code)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs text-ink-500">點任一條（金色＝目前選定縣市）可切換到該縣市的鄉鎮明細。</p>
      </Section>

      {/* 縣市內鄉鎮排行 */}
      <Section
        kicker="鄉鎮明細"
        title={`${ccName}：各區租金投報率排行`}
        right={
          <select className="input" value={cc} onChange={(e) => setCc(e.target.value)}>
            {counties.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        }
      >
        {bestDist && (
          <p className="mb-4 text-sm text-ink-600">
            {ccName}收租回報最高的是 <strong>{bestDist.district}</strong>，
            年化約 <span className="stat-num text-up">{(bestDist.y! * 100).toFixed(2)}%</span>
            （房價中位 {fmtPing(bestDist.saleP)} 萬/坪、月租中位 {fmt(bestDist.rentP, 0)} 元/坪）。
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="table-clean w-full">
            <thead>
              <tr>
                <th>鄉鎮市區</th>
                <th className="text-right">年化投報</th>
                <th className="text-right">評級</th>
                <th className="text-right">房價中位（萬/坪）</th>
                <th className="text-right">月租中位（元/坪）</th>
                <th className="text-right">買賣量</th>
                <th className="text-right">租賃量</th>
              </tr>
            </thead>
            <tbody>
              {districtYields.map((d) => {
                const t = yieldTone(d.y);
                return (
                  <tr key={d.district}>
                    <td className="font-medium text-ink-900">{d.district}</td>
                    <td className={`text-right stat-num font-medium ${t.tone}`}>{(d.y! * 100).toFixed(2)}%</td>
                    <td className={`text-right ${t.tone}`}>{t.label}</td>
                    <td className="text-right stat-num">{fmtPing(d.saleP)}</td>
                    <td className="text-right stat-num">{fmt(d.rentP, 0)}</td>
                    <td className="text-right stat-num text-ink-500">{fmt(d.saleDeals)}</td>
                    <td className="text-right stat-num text-ink-500">{fmt(d.rentDeals)}</td>
                  </tr>
                );
              })}
              {districtYields.length === 0 && (
                <tr><td colSpan={7} className="py-8 text-center text-ink-400">此縣市租賃或買賣樣本不足（需各區 ≥10 筆），無法估算投報率。</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <Section kicker="怎麼讀這個數字" title="投報率的眉角">
        <ul className="text-sm leading-7 text-ink-700 list-disc pl-5">
          <li>本頁為<strong>毛投報率</strong>（年租金 ÷ 房價），<strong>未扣</strong>管理費、房屋稅地價稅、修繕、仲介、空置期與貸款利息。實拿淨投報通常再低 0.5~1.5%。</li>
          <li>用的是<strong>區域中位</strong>租與售，個別物件會因屋況、樓層、車位、含不含家具而差很多。</li>
          <li>台灣都會區投報普遍偏低（雙北常 &lt; 2.5%），因為房價有「增值預期」灌在裡面；<strong>高投報區（&gt; 4%）常是房價成長性較弱的區</strong>，要兩面一起評估。</li>
          <li>收租決策請再看：<strong>租賃需求穩定度</strong>（學區、商圈、產業聚落）、<strong>去化天數</strong>、屋齡與管理品質。</li>
        </ul>
      </Section>
    </div>
  );
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
