import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { data, type HeatmapRow, type MomentumRow, type Meta } from "../lib/data";
import { buildAreaNarrative, type AreaNarrative } from "../lib/analysis";
import { fmt, fmtPct, fmtPing, fmtWan } from "../lib/format";
import { buildBuyerReportMessages, buyerReportResponseSchema, type BuyerReportPayload } from "../lib/llmContract";
import { clearShortlist, removeShortlist, useShortlist } from "../lib/shortlist";
import Section from "../components/Section";
import { Kpi, KpiBar } from "../components/KpiBar";

type ReportItem = {
  county: string;
  countyName: string;
  district: string;
  heat: HeatmapRow | null;
  momentum: MomentumRow | null;
  countyMedian: number | null;
  narrative: AreaNarrative | null;
};

function median(xs: number[]) {
  const sorted = xs.filter(Boolean).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
}

function rankItem(item: ReportItem) {
  if (!item.heat || !item.narrative) return 0;
  let score = 50;
  if ((item.heat.deals ?? 0) >= 120) score += 16;
  else if ((item.heat.deals ?? 0) < 30) score -= 18;
  if (item.countyMedian && item.heat.median_unit_price_ping) {
    const ratio = item.heat.median_unit_price_ping / item.countyMedian;
    if (ratio < 0.9) score += 14;
    if (ratio > 1.2) score -= 12;
  }
  const mom = item.momentum?.pct_change;
  if (mom != null && mom > 0.15) score -= 10;
  else if (mom != null && mom > -0.08) score += 8;
  score -= item.narrative.warnings.length * 5;
  score += item.narrative.notes.length * 3;
  return Math.max(0, Math.min(100, score));
}

export default function ReportPage({ meta }: { meta: Meta | null }) {
  const shortlist = useShortlist();
  const [items, setItems] = useState<ReportItem[]>([]);
  const [copied, setCopied] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    async function run() {
      const counties = Array.from(new Set(shortlist.map((x) => x.county)));
      const loaded = await Promise.all(counties.map(async (cc) => {
        const [heat, momentum] = await Promise.all([
          data.heatmap(cc, "sale").catch(() => [] as HeatmapRow[]),
          data.momentum(cc, "sale").catch(() => [] as MomentumRow[]),
        ]);
        return { cc, heat, momentum, countyMedian: median(heat.map((h) => h.median_unit_price_ping ?? 0)) };
      }));
      const byCounty = new Map(loaded.map((x) => [x.cc, x]));
      const next = shortlist.map((s) => {
        const pack = byCounty.get(s.county);
        const heat = pack?.heat.find((h) => h.district === s.district) ?? null;
        const momentum = pack?.momentum.find((m) => m.district === s.district) ?? null;
        const narrative = heat ? buildAreaNarrative({
          row: heat,
          momentum: momentum ?? undefined,
          countyMedian: pack?.countyMedian ?? null,
        }) : null;
        return {
          county: s.county,
          countyName: s.countyName,
          district: s.district,
          heat,
          momentum,
          countyMedian: pack?.countyMedian ?? null,
          narrative,
        };
      }).sort((a, b) => rankItem(b) - rankItem(a));
      if (alive) setItems(next);
    }
    run();
    return () => { alive = false; };
  }, [shortlist]);

  const best = items[0] ?? null;
  const ready = items.filter((x) => x.heat);
  const avgScore = ready.length ? ready.reduce((s, x) => s + rankItem(x), 0) / ready.length : null;
  const aiPayload = useMemo<BuyerReportPayload>(() => ({
    generated_at: new Date().toISOString(),
    data_version: meta?.generated_at ?? null,
    last_deal_date: meta?.last_deal_date ?? null,
    purpose: "buyer_area_report",
    items: items.map((x) => ({
      county: x.countyName,
      district: x.district,
      score: rankItem(x),
      median_unit_price_ping: x.heat?.median_unit_price_ping ?? null,
      median_total_price: x.heat?.median_total_price ?? null,
      deals_12m: x.heat?.deals ?? null,
      momentum_6m: x.momentum?.pct_change ?? null,
      confidence: x.narrative?.confidence ?? null,
      headline: x.narrative?.headline ?? null,
      strengths: x.narrative?.notes ?? [],
      warnings: x.narrative?.warnings ?? [],
    })),
    instruction_hint: "Use only the provided evidence. Do not invent market facts. Explain trade-offs and mention confidence.",
  }), [items, meta]);
  const llmContract = useMemo(() => ({
    messages: buildBuyerReportMessages(aiPayload),
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "buyer_area_report",
        schema: buyerReportResponseSchema,
        strict: true,
      },
    },
  }), [aiPayload]);

  const copyPayload = async () => {
    await navigator.clipboard.writeText(JSON.stringify(aiPayload, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  const copyPrompt = async () => {
    await navigator.clipboard.writeText(JSON.stringify(llmContract, null, 2));
    setPromptCopied(true);
    window.setTimeout(() => setPromptCopied(false), 1600);
  };

  return (
    <div className="space-y-6">
      <section className="panel p-8">
        <div className="label">Decision Report</div>
        <h1 className="mt-2 font-serif text-3xl text-ink-900">買房區域報告</h1>
        <p className="mt-3 max-w-3xl text-ink-600 leading-7">
          這份報告會整理比較籃中的行政區，列出行情、成交量、短期動能、優勢與風險。
          目前是可驗證的資料摘要，之後可直接接 LLM 產生自然語言報告。
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link to="/dashboard" className="btn">回儀表板找區域</Link>
          <Link to="/compare" className="btn">回多區比較</Link>
          {shortlist.length > 0 && <button onClick={clearShortlist} className="btn text-down border-down/30">清空比較籃</button>}
        </div>
      </section>

      <KpiBar>
        <Kpi label="報告區域" value={fmt(ready.length)} sub="比較籃有效資料" />
        <Kpi label="首選區域" value={best ? `${best.countyName} ${best.district}` : "—"} sub={best?.narrative?.headline ?? "尚無資料"} accent={best ? "up" : "default"} />
        <Kpi label="平均分數" value={avgScore ? `${avgScore.toFixed(0)} / 100` : "—"} sub="依成交量、價格、動能與風險估算" />
        <Kpi label="資料版本" value={meta?.last_deal_date?.sale ?? "—"} sub="買賣最新成交日" />
      </KpiBar>

      {!shortlist.length && (
        <Section kicker="空白報告" title="先把候選區加入比較籃">
          <div className="text-sm text-ink-600 leading-7">
            到買房儀表板、縣市深掘或地圖搜尋，把想比較的行政區加入比較籃後，這裡就會生成區域報告。
          </div>
        </Section>
      )}

      {items.map((item, idx) => {
        const score = rankItem(item);
        return (
          <Section
            key={`${item.county}|${item.district}`}
            kicker={`#${idx + 1} · ${item.countyName}`}
            title={`${item.district} · ${item.narrative?.headline ?? "資料不足"}`}
            right={<span className={`pill ${score >= 70 ? "text-up" : score < 45 ? "text-down" : ""}`}>{score.toFixed(0)} / 100</span>}
          >
            {item.heat && item.narrative ? (
              <div className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-1">
                  <ReportMetric label="中位單價" value={`${fmtPing(item.heat.median_unit_price_ping)} 萬/坪`} />
                  <ReportMetric label="中位總價" value={`${fmtWan(item.heat.median_total_price)} 萬`} />
                  <ReportMetric label="近 12 月成交" value={`${fmt(item.heat.deals)} 筆`} tone={(item.heat.deals ?? 0) >= 80 ? "up" : "default"} />
                  <ReportMetric label="近半年動能" value={fmtPct(item.momentum?.pct_change)} tone={(item.momentum?.pct_change ?? 0) > 0 ? "up" : "down"} />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-md border border-ink-200 bg-emerald-50 p-4">
                    <div className="label mb-2 text-up">可利用的優勢</div>
                    {item.narrative.notes.length ? (
                      <ul className="space-y-1.5 text-sm leading-6 text-ink-700">
                        {item.narrative.notes.map((note) => <li key={note}>{note}</li>)}
                      </ul>
                    ) : <div className="text-sm text-ink-500">沒有明顯優勢訊號。</div>}
                  </div>
                  <div className="rounded-md border border-ink-200 bg-rose-50 p-4">
                    <div className="label mb-2 text-down">需要查證的風險</div>
                    {item.narrative.warnings.length ? (
                      <ul className="space-y-1.5 text-sm leading-6 text-ink-700">
                        {item.narrative.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                      </ul>
                    ) : <div className="text-sm text-ink-500">目前沒有明顯資料警訊。</div>}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-ink-500">這個行政區目前沒有足夠資料。</div>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Link className="btn" to={`/region?county=${item.county}&district=${encodeURIComponent(item.district)}&dk=sale`}>看區域深掘</Link>
              <button className="btn text-down border-down/30" onClick={() => removeShortlist(item.county, item.district)}>移出報告</button>
            </div>
          </Section>
        );
      })}

      {items.length > 0 && (
        <Section
          kicker="AI-ready"
          title="可交給 LLM 的資料摘要"
          right={<div className="flex gap-2">
            <button className="btn" onClick={copyPayload}>{copied ? "已複製" : "複製 JSON"}</button>
            <button className="btn" onClick={copyPrompt}>{promptCopied ? "已複製" : "複製 API 契約"}</button>
          </div>}
        >
          <pre className="max-h-[360px] overflow-auto rounded-md bg-ink-900 p-4 text-xs leading-5 text-ink-50">
            {JSON.stringify(aiPayload, null, 2)}
          </pre>
        </Section>
      )}
    </div>
  );
}

function ReportMetric({
  label, value, tone = "default",
}: {
  label: string;
  value: string;
  tone?: "up" | "down" | "default";
}) {
  const color = tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-ink-900";
  return (
    <div className="rounded-md border border-ink-200 bg-white p-3">
      <div className="label">{label}</div>
      <div className={`mt-1 stat-num text-xl ${color}`}>{value}</div>
    </div>
  );
}
