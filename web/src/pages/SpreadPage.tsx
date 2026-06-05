import { useEffect, useMemo, useState } from "react";
import { data, type AskingHistory, type Meta, type SpreadRow, type SpreadSummaryRow, type SpreadTrend } from "../lib/data";
import { fmtPing } from "../lib/format";
import Section from "../components/Section";
import { Kpi, KpiBar } from "../components/KpiBar";
import RoleHero from "../components/RoleHero";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

/** 月供應量（去化速度）：在架量 / 月均成交量。<3 = 賣方市場；>6 = 買方市場。 */
function calcMos(askingN: number | null, soldDeals: number): number | null {
  if (askingN == null || askingN <= 0 || soldDeals <= 0) return null;
  const monthlyRate = soldDeals / 12;
  return +(askingN / monthlyRate).toFixed(1);
}
function mosTone(mos: number | null): { label: string; tone: string } {
  if (mos == null) return { label: "—", tone: "text-ink-400" };
  if (mos < 3) return { label: "賣方市場", tone: "text-down" };
  if (mos < 6) return { label: "均衡", tone: "text-ink-900" };
  if (mos < 12) return { label: "買方偏有利", tone: "text-up" };
  return { label: "明顯供過於求", tone: "text-up font-medium" };
}

/** 議價空間分級（買方可砍價空間 / 賣方該預留的議價彈性）。 */
function spreadTone(p: number | null): { label: string; tone: string } {
  if (p == null) return { label: "—", tone: "text-ink-400" };
  const x = p * 100;
  if (x >= 15) return { label: "空間大", tone: "text-up" };
  if (x >= 10) return { label: "中等", tone: "text-ink-900" };
  if (x >= 5) return { label: "偏小", tone: "text-amber-700" };
  return { label: "幾乎無", tone: "text-down" };
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export default function SpreadPage({ meta }: { meta: Meta | null }) {
  const counties = meta?.counties ?? [];
  const [cc, setCc] = useState("a");
  const [nat, setNat] = useState<SpreadSummaryRow[]>([]);
  const [rows, setRows] = useState<SpreadRow[]>([]);
  const [hist, setHist] = useState<AskingHistory | null>(null);
  const [trend, setTrend] = useState<SpreadTrend | null>(null);

  useEffect(() => { data.spreadSummary().then(setNat).catch(() => setNat([])); }, []);
  useEffect(() => { data.spread(cc).then(setRows).catch(() => setRows([])); }, [cc]);
  useEffect(() => { setHist(null); data.askingHistory(cc).then(setHist).catch(() => setHist(null)); }, [cc]);
  useEffect(() => { setTrend(null); data.spreadTrend(cc).then(setTrend).catch(() => setTrend(null)); }, [cc]);

  // 開價 vs 成交 月線（萬/坪）：成交來自實價登錄、開價來自累積抓取。
  const trendData = useMemo(() => {
    if (!trend) return [];
    return trend.months.map((m, i) => ({
      month: m,
      成交: trend.sold[i] != null ? +(trend.sold[i]! / 10000).toFixed(1) : null,
      開價: trend.asking[i] != null ? +(trend.asking[i]! / 10000).toFixed(1) : null,
    }));
  }, [trend]);
  const hasAskingPoint = trendData.some((d) => d.開價 != null);

  // 開價趨勢 + 待售量：每個抓取日，縣市各區開價中位的中位（萬/坪）+ 在架量合計（純彙總）。
  const askingTrend = useMemo(() => {
    if (!hist?.districts) return [];
    const prices = new Map<string, number[]>();
    const listings = new Map<string, number>();
    for (const series of Object.values(hist.districts)) {
      for (const p of series) {
        if (p.asking_median_ping != null)
          (prices.get(p.date) ?? prices.set(p.date, []).get(p.date)!).push(p.asking_median_ping);
        listings.set(p.date, (listings.get(p.date) ?? 0) + (p.n ?? 0));
      }
    }
    return [...prices.keys(), ...listings.keys()]
      .filter((d, i, a) => a.indexOf(d) === i)
      .sort((a, b) => a.localeCompare(b))
      .map((date) => ({
        date,
        開價中位: prices.has(date) ? +(median(prices.get(date)!) / 10000).toFixed(1) : null,
        在架量: listings.get(date) ?? 0,
      }));
  }, [hist]);
  const latestListings = askingTrend.length ? askingTrend[askingTrend.length - 1].在架量 : null;
  const prevListings = askingTrend.length >= 2 ? askingTrend[askingTrend.length - 2].在架量 : null;

  const ranked = useMemo(
    () => [...nat].filter(d => d.spread_pct != null).sort((a, b) => b.spread_pct - a.spread_pct),
    [nat],
  );
  const ccName = counties.find(c => c.code === cc)?.name ?? cc;
  const ccInfo = nat.find(d => d.county_code === cc);
  const biggest = ranked[0];
  const smallest = ranked[ranked.length - 1];
  const natMedian = ranked.length ? median(ranked.map(d => d.spread_pct)) : null;

  // 區級明細（砍價空間大→小，已在管線排序，但保險起見再排一次）
  const districts = useMemo(
    () => [...rows].filter(r => r.spread_pct != null)
      .sort((a, b) => (b.spread_pct ?? 0) - (a.spread_pct ?? 0)),
    [rows],
  );
  const hasScrape = districts.some(r => r.method === "scrape");

  return (
    <div className="space-y-6">
      <RoleHero kicker="Negotiator's Edge · 議價空間" title="開價 vs 成交：這區能砍多少？" img="/img/accent-seller.webp">
        實價登錄是<strong>成交價</strong>，售屋平台掛的是<strong>開價</strong> —— 兩者之間的落差就是
        <span className="stat-num"> 議價空間</span>。<strong>台南</strong>已實抓售屋平台開價（區級、含在架量與開價趨勢）；
        其他縣市以各縣市議價率回推「目前開價帶」。<strong>對買方</strong>是出價的底氣；<strong>對賣方/業務</strong>是
        訂牌價、抓議價彈性的依據——業務專用視角見 <a href="/broker" className="text-brass-700 underline">業務模式</a>。
        數字為區域中位概估，個案仍受屋況、樓層、急售與否影響。
      </RoleHero>

      {/* 全台縣市排行 */}
      <Section kicker="全台 22 縣市" title="哪個縣市砍價空間最大？">
        <KpiBar>
          <Kpi label="砍價空間最大" value={biggest ? biggest.county_name : "—"}
               sub={biggest ? `約 ${(biggest.spread_pct * 100).toFixed(1)}%` : ""} accent="up" />
          <Kpi label="砍價空間最小" value={smallest ? smallest.county_name : "—"}
               sub={smallest ? `約 ${(smallest.spread_pct * 100).toFixed(1)}%` : ""} accent="down" />
          <Kpi label={`${ccName} 議價空間`}
               value={ccInfo ? `${(ccInfo.spread_pct * 100).toFixed(1)}%` : "—"}
               sub={ccInfo?.period ? `資料期 ${ccInfo.period}` : "目前選定縣市"} />
          <Kpi label="全台中位議價空間"
               value={natMedian != null ? `${(natMedian * 100).toFixed(1)}%` : "—"}
               sub="22 縣市中位數" />
        </KpiBar>

        <div className="mt-6 h-[460px]">
          <ResponsiveContainer>
            <BarChart data={ranked.map(d => ({ name: d.county_name, 議價空間: +(d.spread_pct * 100).toFixed(1), code: d.county_code }))}
                      layout="vertical" margin={{ top: 4, right: 44, left: 8, bottom: 4 }}>
              <CartesianGrid stroke="#e3dac8" horizontal={false} />
              <XAxis type="number" stroke="#a99e86" tickFormatter={(v) => `${v}%`} />
              <YAxis type="category" dataKey="name" stroke="#a99e86" width={56} tick={{ fontSize: 12 }} />
              <Tooltip
                contentStyle={{ background: "#1c1813", border: "none", color: "#f8f4ec", fontSize: 12, borderRadius: 6 }}
                formatter={(v: any) => [`${v}%`, "議價空間"]}
              />
              <Bar dataKey="議價空間" radius={[0, 3, 3, 0]}>
                {ranked.map((d) => (
                  <Cell key={d.county_code} fill={d.county_code === cc ? "#b8862c" : "#a99e86"}
                        cursor="pointer" onClick={() => setCc(d.county_code)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs text-ink-500">點任一條（金色＝目前選定縣市）切換到該縣市的鄉鎮明細。</p>
      </Section>

      {/* 縣市內鄉鎮明細 */}
      <Section
        kicker="鄉鎮明細"
        title={`${ccName}：各區開價 vs 成交`}
        right={
          <select className="input" value={cc} onChange={(e) => setCc(e.target.value)}>
            {counties.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        }
      >
        <div className="overflow-x-auto">
          <table className="table-clean w-full">
            <thead>
              <tr>
                <th>鄉鎮市區</th>
                <th className="text-right">議價空間</th>
                <th className="text-right">評級</th>
                <th className="text-right">開價中位（萬/坪）</th>
                <th className="text-right">成交中位（萬/坪）</th>
                <th className="text-right">成交量</th>
                <th className="text-right">在架量</th>
                <th className="text-right">月供應量</th>
                <th className="text-right">來源</th>
              </tr>
            </thead>
            <tbody>
              {districts.map((r) => {
                const t = spreadTone(r.spread_pct);
                const thin = (r.sold_deals ?? 0) < 20;
                return (
                  <tr key={r.district} className={thin ? "opacity-50" : ""}>
                    <td className="font-medium text-ink-900">
                      {r.district}
                      {thin && <span className="ml-1 rounded bg-ink-200/60 px-1 py-0.5 text-[10px] text-ink-400">少量</span>}
                    </td>
                    <td className={`text-right stat-num font-medium ${t.tone}`}>
                      {r.spread_pct != null ? `${(r.spread_pct * 100).toFixed(1)}%` : "—"}
                    </td>
                    <td className={`text-right ${t.tone}`}>{t.label}</td>
                    <td className="text-right stat-num">{fmtPing(r.asking_median_ping)}</td>
                    <td className="text-right stat-num">{fmtPing(r.sold_median_ping)}</td>
                    <td className="text-right stat-num text-ink-500">{r.sold_deals.toLocaleString()}</td>
                    <td className="text-right stat-num text-ink-500">
                      {r.asking_n != null ? r.asking_n.toLocaleString() : "—"}
                    </td>
                    <td className="text-right">
                      {(() => {
                        const mos = calcMos(r.asking_n, r.sold_deals);
                        const mt = mosTone(mos);
                        return mos != null
                          ? <span className={`text-sm ${mt.tone}`}>{mos} 個月</span>
                          : <span className="text-ink-400">—</span>;
                      })()}
                    </td>
                    <td className="text-right">
                      {r.method === "scrape"
                        ? <span className="rounded bg-up/10 px-1.5 py-0.5 text-[11px] text-up">實抓開價{r.asking_n ? `·${r.asking_n}筆` : ""}</span>
                        : <span className="rounded bg-ink-200/60 px-1.5 py-0.5 text-[11px] text-ink-500">議價率推估</span>}
                    </td>
                  </tr>
                );
              })}
              {districts.length === 0 && (
                <tr><td colSpan={9} className="py-8 text-center text-ink-400">此縣市暫無資料。</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {ccInfo?.source && (
          <p className="mt-3 text-xs text-ink-500">
            議價率來源：{ccInfo.source}{ccInfo.period ? `（${ccInfo.period}）` : ""}。
            {!hasScrape && "本縣市目前以議價率回推開價（縣市級），各區共用同一議價率；待接入區級開價抓取後會自動細分。"}
          </p>
        )}
      </Section>

      {/* 開價趨勢（領先指標）—— 隨每次排程抓取累積 */}
      <Section
        kicker="領先指標 · 開價 vs 成交月線"
        title={`${ccName}：開價與成交的月度落差走勢`}
        right={
          <select className="input" value={cc} onChange={(e) => setCc(e.target.value)}>
            {counties.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        }
      >
        {latestListings != null && latestListings > 0 && (
          <KpiBar>
            <Kpi label={`${ccName} 目前在架量`} value={latestListings.toLocaleString()}
                 sub="實抓售屋平台（待售物件數）" />
            <Kpi label="較上次變化"
                 value={prevListings != null ? `${latestListings - prevListings >= 0 ? "+" : ""}${(latestListings - prevListings).toLocaleString()}` : "—"}
                 sub={prevListings != null ? "vs 上一個抓取點" : "需第 2 個抓取點"}
                 accent={prevListings != null && latestListings - prevListings > 0 ? "up" : prevListings != null && latestListings - prevListings < 0 ? "down" : undefined} />
            <Kpi label="累積抓取點" value={`${askingTrend.length}`} sub="開價/在架歷史時間點" />
          </KpiBar>
        )}
        {trendData.length > 0 ? (
          <>
            <div className="mt-6 h-[340px]">
              <ResponsiveContainer>
                <LineChart data={trendData} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
                  <CartesianGrid stroke="#e3dac8" />
                  <XAxis dataKey="month" stroke="#a99e86" tick={{ fontSize: 11 }} minTickGap={24} />
                  <YAxis stroke="#a99e86" width={44} tickFormatter={(v) => `${v}`} domain={["auto", "auto"]} />
                  <Tooltip
                    contentStyle={{ background: "#1c1813", border: "none", color: "#f8f4ec", fontSize: 12, borderRadius: 6 }}
                    formatter={(v: any, n: any) => [`${v} 萬/坪`, n]}
                  />
                  <Line type="monotone" dataKey="成交" stroke="#8a7a5c" strokeWidth={2} dot={false} connectNulls />
                  <Line type="monotone" dataKey="開價" stroke="#b8862c" strokeWidth={2.5} dot={{ r: 4 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-ink-500">
              <span className="text-[#8a7a5c]">▬ 成交中位（實價登錄，落後 1~2 月）</span>{"　"}
              <span className="text-[#b8862c]">● 開價中位（售屋平台，當期）</span>。
              開價是<strong>領先指標</strong>、成交是落後指標。
              {hasAskingPoint
                ? "開價點會隨每週排程累積成線，屆時可直接讀月度落差的擴大/收斂。"
                : "開價線需累積抓取點，下次排程後浮現。"}
            </p>
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-ink-300 bg-paper/40 px-5 py-8 text-center">
            <p className="text-sm text-ink-700">
              {ccName} 目前無成交月度資料可畫趨勢。本站<strong>開價深耕台南</strong>，其他縣市開價以議價率回推。
            </p>
          </div>
        )}
      </Section>

      <Section kicker="怎麼讀這個數字" title="議價空間的眉角">
        <ul className="text-sm leading-7 text-ink-700 list-disc pl-5">
          <li><strong>議價空間 =（開價 − 成交）/ 開價</strong>。例：開價 100 萬/坪、成交 87 萬/坪 → 議價空間 13%。</li>
          <li>標「<strong>議價率推估</strong>」的列，是用該縣市公布的<strong>平均議價率</strong>回推開價（縣市級，同縣市各區一致）；標「<strong>實抓開價</strong>」的列，是用實際蒐集到的該區<strong>開價中位</strong>直接比對（區級、更精準）。</li>
          <li>這是<strong>區域中位</strong>的概估，<strong>不是</strong>任何單一物件的可砍幅度。實際議價受屋況、樓層、車位、賣方急迫度、是否含裝潢影響很大。</li>
          <li>議價空間大不等於「便宜」—— 可能是該區<strong>開價普遍偏高</strong>或去化較慢；要搭配成交價趨勢與成交量一起看。</li>
          <li><strong>月供應量</strong>＝在架量 ÷ 月均成交量（近12月成交 ÷ 12）。&lt;3 個月＝供不應求（賣方市場），3–6＝均衡，&gt;6＝供給充足（買方偏有利），&gt;12＝明顯供過於求。此指標需要同一個區同時有實抓開價（在架量）與成交資料，台南以外多半顯示「—」。</li>
          <li>成交資料來自內政部實價登錄；開價資料僅供市場參考，不構成出價、訂價或投資建議。</li>
        </ul>
      </Section>
    </div>
  );
}
