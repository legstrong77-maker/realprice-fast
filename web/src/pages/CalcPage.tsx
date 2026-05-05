import { useEffect, useMemo, useState } from "react";
import { affordablePrice, amortizationByYear, monthlyPayment, stressTest } from "../lib/calc";
import { fmt, fmtWan, fmtPct } from "../lib/format";
import { Kpi, KpiBar } from "../components/KpiBar";
import Section from "../components/Section";
import { data, type CountySummary, type DealKind } from "../lib/data";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ComposedChart, Bar,
} from "recharts";

export default function CalcPage() {
  // ── 共用利率 / 年期
  const [rate, setRate] = useState(2.225);   // 央行公股 2.225%（2026 同水準）
  const [years, setYears] = useState(30);

  // ── 房貸試算
  const [totalPrice, setTotalPrice] = useState(2000); // 萬
  const [downPct, setDownPct] = useState(20);
  const principal = useMemo(
    () => totalPrice * 10000 * (1 - downPct / 100),
    [totalPrice, downPct]
  );
  const monthly = monthlyPayment(principal, rate / 100, years);
  const totalPaid = monthly * years * 12;
  const totalInt = totalPaid - principal;
  const amort = amortizationByYear(principal, rate / 100, years);

  // ── 可負擔房價
  const [income, setIncome] = useState(60000);
  const [dti, setDti] = useState(35);
  const [savings, setSavings] = useState(200);  // 萬
  const aff = affordablePrice(income, rate / 100, years, dti / 100, savings * 10000);

  // ── 升息壓測
  const stress = stressTest(principal, rate / 100, years);

  // ── 「以縣市中位推估你能買到什麼」
  const [county, setCounty] = useState("a");
  const [dealKind] = useState<DealKind>("sale");
  const [summary, setSummary] = useState<Record<DealKind, CountySummary[]> | null>(null);
  useEffect(() => { data.countySummary().then(setSummary).catch(() => {}); }, []);
  const cs = summary?.[dealKind] ?? [];
  const ccRow = cs.find(r => r.county_code === county);
  const medianPing = ccRow?.median_unit_price_ping ?? null;
  const ableSqmPing = medianPing ? (aff.totalPrice / medianPing) : null;

  return (
    <div className="space-y-8">
      <section className="panel p-8">
        <div className="label">Buyer's Lab</div>
        <h1 className="mt-2 font-serif text-3xl text-ink-900">購屋者試算工具</h1>
        <p className="mt-3 max-w-2xl text-ink-600 leading-7">
          所有計算在你的瀏覽器裡跑，不會送到任何伺服器。
          以下不構成購屋或財務建議，只把數字算清楚給你看。
        </p>
      </section>

      {/* 共用設定 */}
      <Section kicker="基準" title="利率與年期">
        <div className="grid gap-6 md:grid-cols-2">
          <Field label={`年利率 ${rate.toFixed(3)} %`}>
            <input type="range" min={1} max={5} step={0.025} value={rate}
              onChange={e => setRate(+e.target.value)} className="w-full" />
            <div className="flex justify-between text-[11px] text-ink-400 mt-1"><span>1.0%</span><span>3.0%</span><span>5.0%</span></div>
          </Field>
          <Field label={`貸款年期 ${years} 年`}>
            <input type="range" min={5} max={40} step={1} value={years}
              onChange={e => setYears(+e.target.value)} className="w-full" />
            <div className="flex justify-between text-[11px] text-ink-400 mt-1"><span>5</span><span>20</span><span>40</span></div>
          </Field>
        </div>
      </Section>

      {/* 房貸試算 */}
      <Section kicker="工具 1" title="房貸試算">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-4">
            <Field label={`總價 ${fmt(totalPrice)} 萬`}>
              <input type="range" min={300} max={10000} step={50} value={totalPrice}
                onChange={e => setTotalPrice(+e.target.value)} className="w-full" />
            </Field>
            <Field label={`自備款比例 ${downPct} %`}>
              <input type="range" min={10} max={50} step={1} value={downPct}
                onChange={e => setDownPct(+e.target.value)} className="w-full" />
            </Field>
            <div className="rounded-md border border-ink-200 bg-ink-50 p-3 text-sm space-y-1">
              <Row k="自備款" v={`${fmtWan(totalPrice * 10000 * downPct / 100)} 萬`} />
              <Row k="貸款本金" v={`${fmtWan(principal)} 萬`} />
            </div>
          </div>
          <KpiBar>
            <Kpi label="月付" value={`${fmt(Math.round(monthly))}`} sub="元 / 月" />
            <Kpi label="總利息" value={`${fmtWan(totalInt)}`} sub={`萬元（${years} 年總和）`} />
          </KpiBar>
        </div>

        <div className="mt-6 h-[260px]">
          <ResponsiveContainer>
            <ComposedChart data={amort.map(a => ({
              year: a.year,
              本金: Math.round(a.principal_paid),
              利息: Math.round(a.interest_paid),
              剩餘本金: Math.round(a.balance),
            }))} margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#e7e5e4" vertical={false} />
              <XAxis dataKey="year" stroke="#a8a29e" />
              <YAxis yAxisId="left" stroke="#a8a29e" tickFormatter={(v)=>`${(v/10000).toFixed(0)}萬`} />
              <YAxis yAxisId="right" orientation="right" stroke="#a8a29e" tickFormatter={(v)=>`${(v/10000).toFixed(0)}萬`} />
              <Tooltip
                contentStyle={{ background: "#1c1917", border: "none", color: "#fafaf9", fontSize: 12, borderRadius: 6 }}
                formatter={(v: any, k: string) => [`${fmt(+v)} 元`, k]}
              />
              <Bar yAxisId="left" dataKey="本金" stackId="a" fill="#1d4ed8" />
              <Bar yAxisId="left" dataKey="利息" stackId="a" fill="#fca5a5" />
              <Line yAxisId="right" type="monotone" dataKey="剩餘本金" stroke="#1c1917" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs text-ink-500">
          柱：每年付出的本金（藍）+ 利息（紅）/ 線：剩餘本金（黑）
        </p>
      </Section>

      {/* 可負擔房價 */}
      <Section kicker="工具 2" title="可負擔房價">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-4">
            <Field label={`月收入 ${fmt(income)} 元`}>
              <input type="range" min={20000} max={300000} step={1000} value={income}
                onChange={e => setIncome(+e.target.value)} className="w-full" />
            </Field>
            <Field label={`貸款負擔率 (DTI) ${dti}%`}>
              <input type="range" min={20} max={50} step={1} value={dti}
                onChange={e => setDti(+e.target.value)} className="w-full" />
              <div className="text-[11px] text-ink-400 mt-1">每月房貸佔月收入比例。一般 ≤ 35% 較保守。</div>
            </Field>
            <Field label={`自備款 ${fmt(savings)} 萬`}>
              <input type="range" min={0} max={2000} step={10} value={savings}
                onChange={e => setSavings(+e.target.value)} className="w-full" />
            </Field>
          </div>
          <KpiBar>
            <Kpi label="可負擔總價" value={`${fmtWan(aff.totalPrice)} 萬`} sub={`貸款 ${fmtWan(aff.loanPrincipal)} 萬 + 自備 ${fmt(savings)} 萬`} />
            <Kpi label="月付" value={`${fmt(Math.round(aff.monthlyPay))} 元`} sub={`= 月收 × ${dti}%`} />
          </KpiBar>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-[1fr_2fr]">
          <select className="rounded-md border border-ink-200 bg-white px-3 py-2 text-sm"
                  value={county} onChange={e => setCounty(e.target.value)}>
            {cs.map(r => <option key={r.county_code} value={r.county_code}>{r.county_name}</option>)}
          </select>
          <div className="rounded-md border border-ink-200 bg-ink-50 p-3 text-sm">
            {medianPing ? (
              <>
                以 {ccRow?.county_name} 中位 <span className="stat-num">{(medianPing/10000).toFixed(1)}</span> 萬/坪 計算，
                你大約能買到 <strong className="stat-num">{ableSqmPing?.toFixed(1)}</strong> 坪的房。
              </>
            ) : "選縣市看推估"}
          </div>
        </div>
      </Section>

      {/* 升息壓力測試 */}
      <Section kicker="工具 3" title="升息壓力測試">
        <p className="text-sm text-ink-600 mb-4">
          以目前的本金 <span className="stat-num text-ink-900">{fmtWan(principal)}</span> 萬、年期 <span className="stat-num text-ink-900">{years}</span> 年，
          若利率 <strong>從 {rate.toFixed(3)}% 起跳</strong>：
        </p>
        <div className="overflow-x-auto">
          <table className="table-clean w-full">
            <thead>
              <tr>
                <th>利率</th>
                <th className="text-right">月付（元）</th>
                <th className="text-right">月付增加</th>
                <th className="text-right">總利息（萬）</th>
              </tr>
            </thead>
            <tbody>
              {stress.map((s, i) => (
                <tr key={i} className={i === 0 ? "bg-ink-50" : ""}>
                  <td className="stat-num font-medium">{(s.rate * 100).toFixed(3)}%</td>
                  <td className="text-right stat-num">{fmt(Math.round(s.monthly))}</td>
                  <td className="text-right stat-num">
                    {i === 0 ? "—" : <span className="text-down">+{fmt(Math.round(s.delta_monthly))}</span>}
                  </td>
                  <td className="text-right stat-num text-ink-500">{fmtWan(s.total_interest)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-sm text-ink-700 mb-2">{label}</div>
      {children}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-ink-500">{k}</span>
      <span className="stat-num text-ink-900">{v}</span>
    </div>
  );
}
