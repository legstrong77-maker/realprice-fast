import { useEffect, useMemo, useState } from "react";
import { data, type EstimatorRow, type Meta } from "../lib/data";
import { fmt, fmtPing, fmtWan } from "../lib/format";
import Section from "../components/Section";
import { Kpi, KpiBar } from "../components/KpiBar";

const AREA_BUCKETS: { key: string; label: string; sqm_min: number; sqm_max: number }[] = [
  { key: "A_lt15", label: "< 15 坪",  sqm_min: 0,      sqm_max: 49.59 },
  { key: "B_15_25", label: "15-25 坪", sqm_min: 49.59,  sqm_max: 82.64 },
  { key: "C_25_35", label: "25-35 坪", sqm_min: 82.64,  sqm_max: 115.70 },
  { key: "D_35_50", label: "35-50 坪", sqm_min: 115.70, sqm_max: 165.29 },
  { key: "E_50_70", label: "50-70 坪", sqm_min: 165.29, sqm_max: 231.41 },
  { key: "F_gt70",  label: "> 70 坪",  sqm_min: 231.41, sqm_max: Infinity },
];

function bucketFor(ping: number): string {
  for (const b of AREA_BUCKETS) {
    const ping_min = b.sqm_min / 3.305785;
    const ping_max = b.sqm_max / 3.305785;
    if (ping >= ping_min && ping < ping_max) return b.key;
  }
  return "F_gt70";
}

export default function EstimatePage({ meta }: { meta: Meta | null }) {
  const counties = meta?.counties ?? [];
  const [cc, setCc] = useState("a");
  const [district, setDistrict] = useState<string>("");
  const [buildingType, setBuildingType] = useState<string>("");
  const [areaPing, setAreaPing] = useState(30);
  const [age, setAge] = useState(15);

  const [allRows, setAllRows] = useState<EstimatorRow[]>([]);

  useEffect(() => {
    data.estimator(cc).then(setAllRows).catch(() => setAllRows([]));
    setDistrict("");
    setBuildingType("");
  }, [cc]);

  const districts = useMemo(
    () => Array.from(new Set(allRows.map(r => r.district))).sort(),
    [allRows]
  );
  const buildingTypes = useMemo(() => {
    const t = allRows.filter(r => !district || r.district === district);
    return Array.from(new Set(t.map(r => r.building_type))).sort();
  }, [allRows, district]);

  const matchedBucket = bucketFor(areaPing);

  const exact = useMemo(() => allRows.find(r =>
    r.district === district &&
    r.building_type === buildingType &&
    r.area_bucket === matchedBucket
  ), [allRows, district, buildingType, matchedBucket]);

  // 退而求其次：同 district 同 building_type 但坪數不限
  const fallback1 = useMemo(() => {
    if (exact) return null;
    const candidates = allRows.filter(r =>
      r.district === district && r.building_type === buildingType
    );
    if (!candidates.length) return null;
    // 加權平均
    const totalN = candidates.reduce((a, c) => a + c.n, 0);
    const wMean = (k: keyof EstimatorRow) =>
      candidates.reduce((a, c) => a + (c[k] as number || 0) * c.n, 0) / totalN;
    return {
      n: totalN,
      p25: wMean("p25"),
      p50: wMean("p50"),
      p75: wMean("p75"),
      avg_age: wMean("avg_age" as any),
      median_total_price: wMean("median_total_price" as any),
      from: "同區同型態" as const,
    };
  }, [exact, allRows, district, buildingType]);

  // 再退一步：同 district
  const fallback2 = useMemo(() => {
    if (exact || fallback1) return null;
    const candidates = allRows.filter(r => r.district === district);
    if (!candidates.length) return null;
    const totalN = candidates.reduce((a, c) => a + c.n, 0);
    const wMean = (k: keyof EstimatorRow) =>
      candidates.reduce((a, c) => a + (c[k] as number || 0) * c.n, 0) / totalN;
    return {
      n: totalN,
      p25: wMean("p25"),
      p50: wMean("p50"),
      p75: wMean("p75"),
      avg_age: wMean("avg_age" as any),
      median_total_price: wMean("median_total_price" as any),
      from: "同區" as const,
    };
  }, [exact, fallback1, allRows, district]);

  const result = exact ? { ...exact, from: "完全符合條件" as const, n: exact.n } :
                 (fallback1 ?? fallback2);

  // 估價：面積 × p50 = 總價
  const total = result ? result.p50 * areaPing : null;
  const totalLow = result ? result.p25 * areaPing : null;
  const totalHigh = result ? result.p75 * areaPing : null;

  return (
    <div className="space-y-6">
      <section className="panel p-8">
        <div className="label">Buyer's Lab · 估價工具</div>
        <h1 className="mt-2 font-serif text-3xl text-ink-900">這個價位合理嗎？</h1>
        <p className="mt-3 max-w-2xl text-ink-600 leading-7">
          輸入想買房子的<strong>地區、類型、坪數、屋齡</strong>，
          我們從近 24 個月所有相似物件的成交資料，給你<strong>合理價區間（P25 / P50 / P75）</strong>。
          數字 = 同條件市場實際成交，**非廣告、非牌價**。
        </p>
      </section>

      {/* 輸入 */}
      <Section kicker="輸入條件" title="你想買的房子">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="縣市">
            <select className="input"
              value={cc}
              onChange={(e) => setCc(e.target.value)}>
              {counties.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </Field>

          <Field label="鄉鎮市區">
            <select className="input"
              value={district}
              onChange={(e) => { setDistrict(e.target.value); setBuildingType(""); }}>
              <option value="">— 請選 —</option>
              {districts.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>

          <Field label="建物型態">
            <select className="input"
              value={buildingType}
              onChange={(e) => setBuildingType(e.target.value)}
              disabled={!district}>
              <option value="">{!district ? "先選鄉鎮" : "— 請選 —"}</option>
              {buildingTypes.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </Field>

          <Field label={`坪數 ${areaPing} 坪`}>
            <input type="range" min={10} max={100} step={1}
              className="w-full"
              value={areaPing}
              onChange={(e) => setAreaPing(+e.target.value)} />
          </Field>

          <Field label={`屋齡（參考用）${age} 年`}>
            <input type="range" min={0} max={60} step={1}
              className="w-full"
              value={age}
              onChange={(e) => setAge(+e.target.value)} />
            <div className="text-[11px] text-ink-400 mt-1">
              ※ 估價暫不依屋齡篩選（樣本太少），但會顯示同條件下的平均屋齡供你比對。
            </div>
          </Field>
        </div>
      </Section>

      {/* 結果 */}
      {result ? (
        <>
          <Section
            kicker={`比對 ${fmt(result.n)} 筆 · ${result.from}`}
            title="合理價區間"
          >
            <KpiBar>
              <Kpi label="P25 偏低" value={`${fmtPing(result.p25)}`}
                   sub={`萬/坪 · 總價約 ${fmtWan(totalLow ? totalLow * 10000 : null, 0)} 萬`} />
              <Kpi label="P50 中位 ⭐" value={`${fmtPing(result.p50)}`}
                   sub={`萬/坪 · 總價約 ${fmtWan(total ? total * 10000 : null, 0)} 萬`}
                   accent="default" />
              <Kpi label="P75 偏高" value={`${fmtPing(result.p75)}`}
                   sub={`萬/坪 · 總價約 ${fmtWan(totalHigh ? totalHigh * 10000 : null, 0)} 萬`} />
              <Kpi label="同條件樣本" value={fmt(result.n)}
                   sub={`平均屋齡 ${result.avg_age?.toFixed(1) ?? "—"} 年`} />
            </KpiBar>

            {/* 視覺化區間條 */}
            <div className="mt-6 rounded-lg border border-ink-200 bg-white p-5">
              <div className="text-xs text-ink-500 mb-2">合理價區間視覺化（每坪萬元）</div>
              <PriceBar p25={result.p25 / 10000} p50={result.p50 / 10000} p75={result.p75 / 10000} />
              <div className="mt-3 text-sm text-ink-600 leading-relaxed">
                {result.from === "完全符合條件" ? (
                  <>建議出價區間：<strong>{(result.p25 / 10000).toFixed(1)} ~ {(result.p75 / 10000).toFixed(1)} 萬/坪</strong>，
                  中位 {(result.p50 / 10000).toFixed(1)} 萬/坪。同條件成交 {fmt(result.n)} 筆。</>
                ) : (
                  <>找不到完全符合「{district}/{buildingType}/{areaPing}坪」的足量成交，
                  以「<strong>{result.from}</strong>」資料估算。建議多看幾筆原始成交比對。</>
                )}
              </div>
            </div>
          </Section>

          <Section kicker="提醒" title="估價以外要注意的事">
            <ul className="text-sm leading-7 text-ink-700 list-disc pl-5">
              <li>本工具<strong>排除特殊註記交易</strong>（凶宅、急售、親友、員工等）</li>
              <li>同一鄉鎮、同類型、同坪數，仍會因地段、座向、樓層、車位、裝潢有差異</li>
              <li>P25 ~ P75 是市場普遍能接受的區間 — 出價低於 P25 屋主多半不賣、高於 P75 你多半買貴</li>
              <li>實際決策前請佐以：銀行估價、屋況、貸款成數、產權謄本</li>
            </ul>
          </Section>
        </>
      ) : (
        <Section kicker="尚未估算" title="請先選擇縣市 + 鄉鎮 + 建物型態">
          <div className="text-ink-400 text-sm py-12 text-center">
            完成上方輸入後，會自動算出該條件下的合理價區間
          </div>
        </Section>
      )}
    </div>
  );
}

function PriceBar({ p25, p50, p75 }: { p25: number; p50: number; p75: number }) {
  const lo = p25 * 0.7;
  const hi = p75 * 1.3;
  const span = hi - lo;
  const pct = (v: number) => `${((v - lo) / span) * 100}%`;
  return (
    <div className="relative h-12">
      <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-1 rounded-full bg-ink-100" />
      <div className="absolute top-1/2 -translate-y-1/2 h-2 rounded-full bg-accent/20"
           style={{ left: pct(p25), width: `calc(${pct(p75)} - ${pct(p25)})` }} />
      <Marker pct={pct(p25)} label="P25" value={p25.toFixed(1)} />
      <Marker pct={pct(p50)} label="中位" value={p50.toFixed(1)} highlight />
      <Marker pct={pct(p75)} label="P75" value={p75.toFixed(1)} />
    </div>
  );
}

function Marker({ pct, label, value, highlight = false }: { pct: string; label: string; value: string; highlight?: boolean }) {
  return (
    <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex flex-col items-center" style={{ left: pct }}>
      <div className={`w-2 h-2 rounded-full ${highlight ? "bg-accent" : "bg-ink-700"}`} />
      <div className={`mt-1 text-[10px] uppercase tracking-wider ${highlight ? "text-accent font-semibold" : "text-ink-500"}`}>{label}</div>
      <div className="absolute top-[14px] stat-num text-xs text-ink-800 whitespace-nowrap">{value}</div>
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
