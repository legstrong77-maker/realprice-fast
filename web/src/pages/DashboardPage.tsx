import { useEffect, useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Link } from "react-router-dom";
import {
  data, type EstimatorRow, type HeatmapRow, type Meta, type MomentumRow,
} from "../lib/data";
import { fmt, fmtPct, fmtPing, fmtWan } from "../lib/format";
import Section from "../components/Section";
import { Kpi, KpiBar } from "../components/KpiBar";
import { addShortlist, isShortlisted, useShortlist } from "../lib/shortlist";

const AREA_BUCKETS = [
  { key: "A_lt15", label: "< 15 坪", min: 0, max: 15 },
  { key: "B_15_25", label: "15-25 坪", min: 15, max: 25 },
  { key: "C_25_35", label: "25-35 坪", min: 25, max: 35 },
  { key: "D_35_50", label: "35-50 坪", min: 35, max: 50 },
  { key: "E_50_70", label: "50-70 坪", min: 50, max: 70 },
  { key: "F_gt70", label: "> 70 坪", min: 70, max: Infinity },
];

const DEFAULT_TYPES = [
  "住宅大樓(11層含以上有電梯)",
  "華廈(10層含以下有電梯)",
  "公寓(5樓含以下無電梯)",
  "透天厝",
];

type Candidate = {
  district: string;
  medianUnit: number | null;
  avgUnit: number | null;
  medianTotal: number | null;
  estimatedTotal: number | null;
  deals: number;
  momentum: number | null;
  estimator: EstimatorRow | null;
  affordability: number | null;
  score: number;
  risk: "低" | "中" | "高";
  advice: string;
  reasons: string[];
};

function bucketFor(ping: number) {
  return AREA_BUCKETS.find((b) => ping >= b.min && ping < b.max)?.key ?? "F_gt70";
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function riskLevel(c: Candidate): Candidate["risk"] {
  let points = 0;
  if (c.deals < 30) points += 2;
  else if (c.deals < 80) points += 1;
  if (c.momentum != null && c.momentum > 0.12) points += 1;
  if (c.momentum != null && c.momentum < -0.12) points += 1;
  if (!c.estimator) points += 1;
  if (c.affordability != null && c.affordability > 1) points += 1;
  if (points >= 4) return "高";
  if (points >= 2) return "中";
  return "低";
}

function adviceFor(c: Candidate, budgetWan: number) {
  if (!c.estimatedTotal) return "資料不足，先看原始成交";
  const totalWan = c.estimatedTotal / 10000;
  if (c.affordability != null && c.affordability <= 0.9 && c.risk === "低") {
    return "優先看屋，可保守開價";
  }
  if (c.affordability != null && c.affordability <= 1 && c.risk !== "高") {
    return "可列入候選，議價空間要看個案";
  }
  if (totalWan <= budgetWan * 1.08 && c.risk !== "高") {
    return "接近預算上緣，先確認貸款與車位";
  }
  if (c.deals < 30) return "樣本偏少，只能當輔助參考";
  return "偏離預算，除非條件特別好";
}

function scoreCandidate(input: {
  heat: HeatmapRow;
  momentum: MomentumRow | undefined;
  estimator: EstimatorRow | undefined;
  budgetWan: number;
  areaPing: number;
}) {
  const { heat, momentum, estimator, budgetWan, areaPing } = input;
  const budget = budgetWan * 10000;
  const estimatedTotal = estimator
    ? estimator.p50 * areaPing
    : heat.median_unit_price_ping
      ? heat.median_unit_price_ping * areaPing
      : heat.median_total_price;
  const affordability = estimatedTotal ? estimatedTotal / budget : null;
  const dealScore = clamp((heat.deals ?? 0) / 160, 0, 1) * 25;
  const affordableScore = affordability == null
    ? 0
    : affordability <= 1
      ? (1 - affordability) * 40 + 32
      : Math.max(0, 26 - (affordability - 1) * 80);
  const momentumScore = momentum?.pct_change == null
    ? 8
    : momentum.pct_change > 0.16
      ? 4
      : momentum.pct_change > 0
        ? 14
        : momentum.pct_change > -0.1
          ? 18
          : 8;
  const estimatorScore = estimator ? clamp(estimator.n / 80, 0, 1) * 18 : 4;
  const score = clamp(affordableScore + dealScore + momentumScore + estimatorScore, 0, 100);
  const candidate: Candidate = {
    district: heat.district,
    medianUnit: heat.median_unit_price_ping,
    avgUnit: heat.avg_unit_price_ping,
    medianTotal: heat.median_total_price,
    estimatedTotal,
    deals: heat.deals ?? 0,
    momentum: momentum?.pct_change ?? null,
    estimator: estimator ?? null,
    affordability,
    score,
    risk: "中",
    advice: "",
    reasons: [],
  };
  candidate.risk = riskLevel(candidate);
  candidate.advice = adviceFor(candidate, budgetWan);
  candidate.reasons = [
    `近 12 月成交 ${fmt(candidate.deals)} 筆`,
    candidate.affordability == null
      ? "預算比無法估算"
      : `估算總價約為預算的 ${(candidate.affordability * 100).toFixed(0)}%`,
    candidate.momentum == null ? "動能資料不足" : `近 6 月動能 ${fmtPct(candidate.momentum)}`,
    candidate.estimator ? `同條件樣本 ${fmt(candidate.estimator.n)} 筆` : "無完全相符估價樣本",
  ];
  return candidate;
}

export default function DashboardPage({ meta }: { meta: Meta | null }) {
  const counties = meta?.counties ?? [];
  const [cc, setCc] = useState("a");
  const [budgetWan, setBudgetWan] = useState(1600);
  const [areaPing, setAreaPing] = useState(30);
  const [buildingType, setBuildingType] = useState(DEFAULT_TYPES[0]);
  const [heatmap, setHeatmap] = useState<HeatmapRow[]>([]);
  const [momentum, setMomentum] = useState<MomentumRow[]>([]);
  const [estimator, setEstimator] = useState<EstimatorRow[]>([]);
  const [loading, setLoading] = useState(false);
  const shortlist = useShortlist();

  useEffect(() => {
    setLoading(true);
    Promise.all([
      data.heatmap(cc, "sale").catch(() => [] as HeatmapRow[]),
      data.momentum(cc, "sale").catch(() => [] as MomentumRow[]),
      data.estimator(cc).catch(() => [] as EstimatorRow[]),
    ]).then(([h, m, e]) => {
      setHeatmap(h);
      setMomentum(m);
      setEstimator(e);
      setLoading(false);
    });
  }, [cc]);

  const buildingTypes = useMemo(() => {
    const fromRows = Array.from(new Set(estimator.map((r) => r.building_type))).sort();
    return fromRows.length ? fromRows : DEFAULT_TYPES;
  }, [estimator]);

  useEffect(() => {
    if (buildingTypes.length && !buildingTypes.includes(buildingType)) {
      setBuildingType(buildingTypes[0]);
    }
  }, [buildingTypes, buildingType]);

  const candidates = useMemo(() => {
    const areaBucket = bucketFor(areaPing);
    return heatmap
      .filter((h) => h.median_unit_price_ping && h.deals)
      .map((h) => {
        const mom = momentum.find((m) => m.district === h.district);
        const est = estimator.find((r) =>
          r.district === h.district &&
          r.building_type === buildingType &&
          r.area_bucket === areaBucket
        );
        return scoreCandidate({ heat: h, momentum: mom, estimator: est, budgetWan, areaPing });
      })
      .sort((a, b) => b.score - a.score);
  }, [heatmap, momentum, estimator, buildingType, budgetWan, areaPing]);

  const best = candidates[0];
  const affordable = candidates.filter((c) => (c.affordability ?? Infinity) <= 1);
  const lowRisk = candidates.filter((c) => c.risk === "低");

  const offer = best?.estimator
    ? {
        conservative: best.estimator.p25 * areaPing,
        fair: best.estimator.p50 * areaPing,
        alert: best.estimator.p75 * areaPing,
      }
    : best?.estimatedTotal
      ? {
          conservative: best.estimatedTotal * 0.94,
          fair: best.estimatedTotal,
          alert: best.estimatedTotal * 1.08,
        }
      : null;
  const countyName = counties.find((c) => c.code === cc)?.name ?? cc;

  const addCandidate = (district: string) => {
    addShortlist({ county: cc, countyName, district, source: "dashboard" });
  };

  return (
    <div className="space-y-6">
      <section className="panel p-8">
        <div className="label">Buyer Decision Dashboard</div>
        <h1 className="mt-2 font-serif text-3xl text-ink-900">買房決策儀表板</h1>
        <p className="mt-3 max-w-3xl text-ink-600 leading-7">
          輸入預算與房型後，系統用近 12 月區域行情、近半年動能與同條件估價樣本，
          排出可優先看屋的地區，並給出保守價、合理價與偏貴警戒。
        </p>
      </section>

      <div className="panel p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="縣市">
            <select className="input" value={cc} onChange={(e) => setCc(e.target.value)}>
              {counties.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </Field>
          <Field label={`預算 ${fmt(budgetWan)} 萬`}>
            <input
              className="w-full"
              type="range"
              min={500}
              max={6000}
              step={50}
              value={budgetWan}
              onChange={(e) => setBudgetWan(Number(e.target.value))}
            />
          </Field>
          <Field label={`室內需求 ${areaPing} 坪`}>
            <input
              className="w-full"
              type="range"
              min={12}
              max={80}
              step={1}
              value={areaPing}
              onChange={(e) => setAreaPing(Number(e.target.value))}
            />
          </Field>
          <Field label="建物型態">
            <select className="input" value={buildingType} onChange={(e) => setBuildingType(e.target.value)}>
              {buildingTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
        </div>
      </div>

      <KpiBar>
        <Kpi label="可負擔行政區" value={fmt(affordable.length)} sub={`估算總價 <= ${fmt(budgetWan)} 萬`} accent={affordable.length ? "up" : "down"} />
        <Kpi label="低風險候選" value={fmt(lowRisk.length)} sub="樣本、動能與預算較穩" />
        <Kpi label="首選區域" value={best?.district ?? "—"} sub={best ? best.advice : loading ? "載入中" : "無資料"} accent={best?.score && best.score >= 70 ? "up" : "default"} />
        <Kpi label="比較籃" value={fmt(shortlist.length)} sub="已收藏行政區" />
      </KpiBar>

      {best && (
        <Section
          kicker="建議結論"
          title={`${best.district}：${best.advice}`}
          right={<span className={`pill ${best.risk === "高" ? "text-down" : best.risk === "低" ? "text-up" : ""}`}>風險 {best.risk}</span>}
        >
          <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
            <div>
              <div className="grid gap-3 md:grid-cols-3">
                <MiniMetric label="估算總價" value={`${fmtWan(best.estimatedTotal)} 萬`} />
                <MiniMetric label="中位單價" value={`${fmtPing(best.medianUnit)} 萬/坪`} />
                <MiniMetric label="決策分數" value={`${best.score.toFixed(0)} / 100`} />
              </div>
              <div className="mt-4 grid gap-2 text-sm text-ink-700 md:grid-cols-2">
                {best.reasons.map((r) => (
                  <div key={r} className="rounded-md border border-ink-200 bg-ink-50 px-3 py-2">{r}</div>
                ))}
              </div>
            </div>
            <div className="rounded-md border border-ink-200 bg-white p-4">
              <div className="label mb-3">出價區間</div>
              {offer ? (
                <div className="space-y-3 text-sm">
                  <OfferRow label="保守開價" value={offer.conservative} hint="可從這裡試探，但熱門區可能很難成交" />
                  <OfferRow label="合理成交" value={offer.fair} hint="接近同條件中位，適合作為主要判斷基準" strong />
                  <OfferRow label="偏貴警戒" value={offer.alert} hint="高於此區間要有屋況、樓層或車位優勢" />
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button className="btn" onClick={() => addCandidate(best.district)}>
                      加入比較籃
                    </button>
                    <Link
                      className="btn btn-active"
                      to={`/calc?price=${Math.round((offer.fair ?? best.estimatedTotal ?? 0) / 10000)}&county=${cc}`}
                    >
                      用此總價試算
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-ink-500">資料不足，先看原始成交。</div>
              )}
            </div>
          </div>
        </Section>
      )}

      <Section
        kicker="候選行政區"
        title="推薦排序"
        right={<span className="text-xs text-ink-500">{loading ? "載入中..." : `共 ${fmt(candidates.length)} 區`}</span>}
      >
        <div className="overflow-x-auto">
          <table className="table-clean w-full">
            <thead>
              <tr>
                <th>排名</th>
                <th>行政區</th>
                <th className="text-right">分數</th>
                <th className="text-right">估算總價</th>
                <th className="text-right">預算比</th>
                <th className="text-right">萬/坪</th>
                <th className="text-right">動能</th>
                <th className="text-right">樣本</th>
                <th>建議</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {candidates.slice(0, 18).map((c, i) => (
                <tr key={c.district}>
                  <td className="stat-num text-ink-500">{i + 1}</td>
                  <td className="font-medium text-ink-900">{c.district}</td>
                  <td className="text-right stat-num">{c.score.toFixed(0)}</td>
                  <td className="text-right stat-num">{fmtWan(c.estimatedTotal)}</td>
                  <td className={`text-right stat-num ${(c.affordability ?? 2) <= 1 ? "text-up" : "text-down"}`}>
                    {c.affordability ? `${(c.affordability * 100).toFixed(0)}%` : "—"}
                  </td>
                  <td className="text-right stat-num">{fmtPing(c.medianUnit)}</td>
                  <td className={`text-right stat-num ${c.momentum != null && c.momentum > 0 ? "text-up" : c.momentum != null ? "text-down" : ""}`}>
                    {fmtPct(c.momentum)}
                  </td>
                  <td className="text-right stat-num text-ink-500">{fmt(c.deals)}</td>
                  <td className="text-sm text-ink-700">{c.advice}</td>
                  <td className="text-right">
                    <button
                      className="text-xs text-accent hover:underline disabled:text-ink-400 disabled:no-underline"
                      disabled={isShortlisted(cc, c.district)}
                      onClick={() => addCandidate(c.district)}
                    >
                      {isShortlisted(cc, c.district) ? "已加入" : "加入比較"}
                    </button>
                  </td>
                </tr>
              ))}
              {!candidates.length && (
                <tr><td colSpan={10} className="py-10 text-center text-ink-400">目前條件下沒有足夠資料</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <Section kicker="視覺比較" title="前 10 名估算總價">
        <div className="h-[300px]">
          <ResponsiveContainer>
            <BarChart
              data={candidates.slice(0, 10).map((c) => ({
                name: c.district,
                total: c.estimatedTotal ? c.estimatedTotal / 10000 : 0,
                score: c.score,
              }))}
              margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
            >
              <CartesianGrid stroke="#e7e5e4" vertical={false} />
              <XAxis dataKey="name" stroke="#a8a29e" />
              <YAxis stroke="#a8a29e" />
              <Tooltip
                contentStyle={{ background: "#1c1917", border: "none", color: "#fafaf9", fontSize: 12, borderRadius: 6 }}
                formatter={(v: any) => [`${fmt(+v)} 萬`, "估算總價"]}
              />
              <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                {candidates.slice(0, 10).map((c) => (
                  <Cell key={c.district} fill={(c.affordability ?? 2) <= 1 ? "#047857" : "#b45309"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <p className="text-xs leading-6 text-ink-500">
        本頁建議由公開成交資料計算而來，不構成投資或購屋保證。樣本過少、特殊屋況、車位、裝潢、樓層、學區與貸款條件都可能讓個案偏離區域統計。
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-sm text-ink-700">{label}</div>
      {children}
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-ink-200 bg-white p-3">
      <div className="label">{label}</div>
      <div className="mt-1 stat-num text-xl text-ink-900">{value}</div>
    </div>
  );
}

function OfferRow({
  label, value, hint, strong,
}: {
  label: string;
  value: number;
  hint: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-dotted border-ink-200 pb-2 last:border-0 last:pb-0">
      <div>
        <div className={strong ? "font-medium text-ink-900" : "text-ink-700"}>{label}</div>
        <div className="text-xs text-ink-500">{hint}</div>
      </div>
      <div className={`stat-num whitespace-nowrap text-right ${strong ? "text-xl text-accent" : "text-ink-900"}`}>
        {fmtWan(value)} 萬
      </div>
    </div>
  );
}
