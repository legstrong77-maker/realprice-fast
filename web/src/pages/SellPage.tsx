import { useEffect, useMemo, useState } from "react";
import { data, type EstimatorRow, type Meta, type RecentRow } from "../lib/data";
import { fmt, fmtPing, fmtWan, fmtDate } from "../lib/format";
import Section from "../components/Section";
import { Kpi, KpiBar } from "../components/KpiBar";

const AREA_BUCKETS: { key: string; sqm_min: number; sqm_max: number }[] = [
  { key: "A_lt15", sqm_min: 0, sqm_max: 49.59 },
  { key: "B_15_25", sqm_min: 49.59, sqm_max: 82.64 },
  { key: "C_25_35", sqm_min: 82.64, sqm_max: 115.70 },
  { key: "D_35_50", sqm_min: 115.70, sqm_max: 165.29 },
  { key: "E_50_70", sqm_min: 165.29, sqm_max: 231.41 },
  { key: "F_gt70", sqm_min: 231.41, sqm_max: Infinity },
];
function bucketFor(ping: number): string {
  for (const b of AREA_BUCKETS) {
    if (ping >= b.sqm_min / 3.305785 && ping < b.sqm_max / 3.305785) return b.key;
  }
  return "F_gt70";
}

/** 樓層溢價（自住市場慣例的粗估，非實證係數，使用者可關掉）。 */
const FLOOR_ADJ: { key: string; label: string; adj: number; hint: string }[] = [
  { key: "g", label: "1 樓（店面/有庭院）", adj: 0.0, hint: "店面另有店租行情，住宅 1 樓常折價" },
  { key: "low", label: "2–3 樓（低樓層）", adj: -0.04, hint: "採光、噪音較差，市場普遍折讓" },
  { key: "mid", label: "中間樓層", adj: 0.0, hint: "以區域中位為基準" },
  { key: "high", label: "高樓層 / 次頂", adj: 0.05, hint: "景觀、採光佳，常有溢價" },
  { key: "top", label: "頂樓", adj: -0.02, hint: "漏水、西曬疑慮，除非有露台加分" },
];

export default function SellPage({ meta }: { meta: Meta | null }) {
  const counties = meta?.counties ?? [];
  const [cc, setCc] = useState("a");
  const [district, setDistrict] = useState("");
  const [buildingType, setBuildingType] = useState("");
  const [areaPing, setAreaPing] = useState(30);
  const [floorKey, setFloorKey] = useState("mid");
  const [useFloorAdj, setUseFloorAdj] = useState(true);
  const [bargainPct, setBargainPct] = useState(6);  // 預留議價空間 %
  const [roadKw, setRoadKw] = useState("");

  const [rows, setRows] = useState<EstimatorRow[]>([]);
  const [recent, setRecent] = useState<RecentRow[]>([]);

  useEffect(() => {
    data.estimator(cc).then(setRows).catch(() => setRows([]));
    data.recent(cc, "sale").then(setRecent).catch(() => setRecent([]));
    setDistrict("");
    setBuildingType("");
  }, [cc]);

  const districts = useMemo(() => Array.from(new Set(rows.map(r => r.district))).sort(), [rows]);
  const buildingTypes = useMemo(() => {
    const t = rows.filter(r => !district || r.district === district);
    return Array.from(new Set(t.map(r => r.building_type))).sort();
  }, [rows, district]);

  const bucket = bucketFor(areaPing);
  const exact = useMemo(() => rows.find(r =>
    r.district === district && r.building_type === buildingType && r.area_bucket === bucket
  ), [rows, district, buildingType, bucket]);

  const fallback = useMemo(() => {
    if (exact) return null;
    const cands = rows.filter(r => r.district === district && (!buildingType || r.building_type === buildingType));
    if (!cands.length) return null;
    const totalN = cands.reduce((a, c) => a + c.n, 0);
    const w = (k: keyof EstimatorRow) => cands.reduce((a, c) => a + (c[k] as number || 0) * c.n, 0) / totalN;
    return { n: totalN, p25: w("p25"), p50: w("p50"), p75: w("p75"), from: buildingType ? "同區同型態" : "同區" };
  }, [exact, rows, district, buildingType]);

  const base = exact ? { ...exact, from: "完全符合條件" } : fallback;

  const floorAdj = useFloorAdj ? (FLOOR_ADJ.find(f => f.key === floorKey)?.adj ?? 0) : 0;

  // 估值（每坪，已套樓層調整）
  const adjPing = base ? {
    p25: base.p25 * (1 + floorAdj),
    p50: base.p50 * (1 + floorAdj),
    p75: base.p75 * (1 + floorAdj),
  } : null;

  // 總價
  const fairValue = adjPing ? adjPing.p50 * areaPing : null;      // 合理成交價（屋主實拿目標）
  const lowValue = adjPing ? adjPing.p25 * areaPing : null;
  const highValue = adjPing ? adjPing.p75 * areaPing : null;
  const askPrice = fairValue ? fairValue * (1 + bargainPct / 100) : null;  // 建議開價（含議價空間）

  // 同區（可選同路段關鍵字）近期成交當佐證
  const comps = useMemo(() => {
    if (!district) return [];
    const kw = roadKw.trim();
    return recent
      .filter(r => r.district === district && !r.is_special_deal && r.unit_price_per_ping)
      .filter(r => !kw || (r.address?.includes(kw) || r.road?.includes(kw)))
      .filter(r => !buildingType || r.building_type === buildingType)
      .sort((a, b) => (b.deal_date < a.deal_date ? -1 : 1))
      .slice(0, 12);
  }, [recent, district, buildingType, roadKw]);

  return (
    <div className="space-y-6">
      <section className="panel p-8">
        <div className="label">Seller's Lab · 賣房估價</div>
        <h1 className="mt-2 font-serif text-3xl text-ink-900">我的房子值多少？該開多少？</h1>
        <p className="mt-3 max-w-2xl text-ink-600 leading-7">
          站在<strong>屋主／賣方業務</strong>的角度：輸入物件條件，從同條件近 24 個月實際成交回推
          <strong>合理成交價</strong>，再依你想預留的<strong>議價空間</strong>給出<strong>建議開價</strong>。
          下方並列同區近期成交，談價時可直接拿來佐證。
        </p>
      </section>

      <Section kicker="輸入你的物件" title="物件條件">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="縣市">
            <select className="input" value={cc} onChange={e => setCc(e.target.value)}>
              {counties.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="鄉鎮市區">
            <select className="input" value={district}
              onChange={e => { setDistrict(e.target.value); setBuildingType(""); }}>
              <option value="">— 請選 —</option>
              {districts.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="建物型態">
            <select className="input" value={buildingType}
              onChange={e => setBuildingType(e.target.value)} disabled={!district}>
              <option value="">{!district ? "先選鄉鎮" : "— 全部型態 —"}</option>
              {buildingTypes.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </Field>
          <Field label={`權狀坪數 ${areaPing} 坪`}>
            <input type="range" min={10} max={100} step={1} className="w-full"
              value={areaPing} onChange={e => setAreaPing(+e.target.value)} />
          </Field>
          <Field label="樓層位置">
            <select className="input" value={floorKey} onChange={e => setFloorKey(e.target.value)}
              disabled={!useFloorAdj}>
              {FLOOR_ADJ.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
            <label className="mt-2 flex items-center gap-2 text-xs text-ink-500">
              <input type="checkbox" checked={useFloorAdj} onChange={e => setUseFloorAdj(e.target.checked)} />
              套用樓層溢價調整（{(floorAdj * 100 > 0 ? "+" : "") + (floorAdj * 100).toFixed(0)}%，僅為市場慣例粗估）
            </label>
          </Field>
          <Field label={`預留議價空間 ${bargainPct}%`}>
            <input type="range" min={0} max={15} step={1} className="w-full"
              value={bargainPct} onChange={e => setBargainPct(+e.target.value)} />
            <div className="text-[11px] text-ink-400 mt-1">開價 = 合理成交價 ×（1 + 議價空間）。熱門地段可壓低，冷門物件可拉高。</div>
          </Field>
        </div>
      </Section>

      {base && adjPing ? (
        <>
          <Section kicker={`比對 ${fmt(base.n)} 筆 · ${base.from}${useFloorAdj && floorAdj !== 0 ? " · 已套樓層調整" : ""}`}
                   title="估值結果">
            <KpiBar>
              <Kpi label="保守成交（P25）" value={`${fmtWan(lowValue, 0)} 萬`} sub={`${fmtPing(adjPing.p25)} 萬/坪`} />
              <Kpi label="合理成交（P50）⭐" value={`${fmtWan(fairValue, 0)} 萬`} sub={`${fmtPing(adjPing.p50)} 萬/坪 · 屋主實拿目標`} accent="default" />
              <Kpi label="偏高成交（P75）" value={`${fmtWan(highValue, 0)} 萬`} sub={`${fmtPing(adjPing.p75)} 萬/坪`} />
              <Kpi label="建議開價" value={`${fmtWan(askPrice, 0)} 萬`} sub={`含 ${bargainPct}% 議價空間`} accent="up" />
            </KpiBar>

            <div className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-md border border-ink-200 bg-white p-4">
                <div className="label mb-3">開價策略</div>
                <div className="space-y-3 text-sm">
                  <OfferLine label="開價（牌價）" value={askPrice} hint={`預留 ${bargainPct}% 給買方砍，是你掛出去的數字`} strong />
                  <OfferLine label="心理底價" value={fairValue} hint="接近同條件市場中位，低於此要想清楚是否急售" />
                  <OfferLine label="保守地板" value={lowValue} hint="同條件偏低區間，除非屋況/產權有瑕疵否則不需賣到這" />
                </div>
              </div>
              <div className="rounded-md border border-ink-200 bg-ink-50 p-4">
                <div className="label mb-3">賣方提醒</div>
                <ul className="space-y-2 text-sm leading-6 text-ink-700">
                  {base.from !== "完全符合條件" && <li>找不到完全同條件足量成交，目前用「{base.from}」估算，開價區間請放寬。</li>}
                  {base.n < 20 && <li>同條件樣本偏少（{fmt(base.n)} 筆），建議再參考下方近期成交逐筆校正。</li>}
                  <li>開太高會拉長銷售期、被買方當「行情高標」對照；開太低會被認為有瑕疵。建議貼著行情中位 +議價空間。</li>
                  <li>車位、裝潢、增建坪數需<strong>另外加價或分開計價</strong>，本估值以區域單價中位為基準。</li>
                  <li>實際成交受帶看量、屋況、產權、貸款成數影響，最終仍以買方銀行估價為準。</li>
                </ul>
              </div>
            </div>
          </Section>

          <Section
            kicker="談價佐證"
            title={`${district || ""} 近期成交（可拿給買方對照）`}
            right={
              <input className="input w-44" placeholder="路名關鍵字篩選"
                value={roadKw} onChange={e => setRoadKw(e.target.value)} />
            }
          >
            <div className="overflow-x-auto">
              <table className="table-clean w-full">
                <thead>
                  <tr>
                    <th>成交日</th>
                    <th>地址</th>
                    <th>型態</th>
                    <th className="text-right">坪數</th>
                    <th className="text-right">單價（萬/坪）</th>
                    <th className="text-right">總價（萬）</th>
                    <th className="text-right">vs 你的合理價</th>
                  </tr>
                </thead>
                <tbody>
                  {comps.map((r) => {
                    const ping = r.building_area_sqm ? r.building_area_sqm / 3.305785 : null;
                    const diff = adjPing.p50 ? (r.unit_price_per_ping! - adjPing.p50) / adjPing.p50 : null;
                    return (
                      <tr key={r.serial_no}>
                        <td className="stat-num text-ink-500">{fmtDate(r.deal_date)}</td>
                        <td className="text-ink-700 max-w-[220px] truncate">{r.address ?? r.road ?? "—"}</td>
                        <td className="text-ink-500 text-xs">{shortType(r.building_type)}</td>
                        <td className="text-right stat-num">{ping ? ping.toFixed(1) : "—"}</td>
                        <td className="text-right stat-num">{fmtPing(r.unit_price_per_ping)}</td>
                        <td className="text-right stat-num">{fmtWan(r.total_price, 0)}</td>
                        <td className={`text-right stat-num ${diff == null ? "" : diff > 0 ? "text-down" : "text-up"}`}>
                          {diff == null ? "—" : `${diff > 0 ? "+" : ""}${(diff * 100).toFixed(0)}%`}
                        </td>
                      </tr>
                    );
                  })}
                  {comps.length === 0 && (
                    <tr><td colSpan={7} className="py-8 text-center text-ink-400">此區近期沒有符合條件的成交可比對，試試放寬型態或清空路名關鍵字。</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-ink-500">
              「vs 你的合理價」為該筆單價相對你估出的 P50 單價：<span className="text-up">綠＝比你估的便宜</span>、
              <span className="text-down"> 紅＝比你估的貴</span>。已排除特殊註記交易。
            </p>
          </Section>
        </>
      ) : (
        <Section kicker="尚未估算" title="請先選擇縣市 + 鄉鎮">
          <div className="text-ink-400 text-sm py-12 text-center">完成上方輸入後，會自動算出建議開價與佐證成交</div>
        </Section>
      )}
    </div>
  );
}

function shortType(t: string | null): string {
  if (!t) return "—";
  return t.replace(/\(.*?\)/g, "").trim() || t;
}

function OfferLine({ label, value, hint, strong }: { label: string; value: number | null; hint: string; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-dotted border-ink-200 pb-2 last:border-0 last:pb-0">
      <div>
        <div className={strong ? "font-medium text-ink-900" : "text-ink-700"}>{label}</div>
        <div className="text-xs text-ink-500">{hint}</div>
      </div>
      <div className={`stat-num whitespace-nowrap text-right ${strong ? "text-xl text-accent" : "text-ink-900"}`}>
        {fmtWan(value, 0)} 萬
      </div>
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
