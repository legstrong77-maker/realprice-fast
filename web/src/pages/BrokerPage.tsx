import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { data, type Meta, type SpreadRow, type SpreadSummaryRow } from "../lib/data";
import { fmtPing } from "../lib/format";
import Section from "../components/Section";
import { Kpi, KpiBar } from "../components/KpiBar";
import RoleHero from "../components/RoleHero";
import {
  buildBrokerBriefMessages, brokerBriefResponseSchema, type BrokerBriefPayload,
} from "../lib/llmContract";

const wan = (eluPing: number | null | undefined) =>
  eluPing != null ? +(eluPing / 10000).toFixed(1) : null;

export default function BrokerPage({ meta }: { meta: Meta | null }) {
  const counties = meta?.counties ?? [];
  const [cc, setCc] = useState("d");           // 預設台南（開價深耕）
  const [rows, setRows] = useState<SpreadRow[]>([]);
  const [nat, setNat] = useState<SpreadSummaryRow[]>([]);
  const [district, setDistrict] = useState<string>("");
  const [audience, setAudience] = useState<"owner" | "buyer">("owner");
  const [copied, setCopied] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);

  useEffect(() => { data.spreadSummary().then(setNat).catch(() => setNat([])); }, []);
  useEffect(() => {
    setDistrict("");
    data.spread(cc).then(setRows).catch(() => setRows([]));
  }, [cc]);

  const ccName = counties.find((c) => c.code === cc)?.name ?? cc;

  // 議價空間大→小（談判機會大的在前）
  const districts = useMemo(
    () => [...rows].filter((r) => r.spread_pct != null)
      .sort((a, b) => (b.spread_pct ?? 0) - (a.spread_pct ?? 0)),
    [rows],
  );
  const scrapeRows = districts.filter((r) => r.method === "scrape");

  // 「可談區」推薦：成交量足夠（≥20 筆）才列入，避免薄資料極端值誤導業務。
  // scrape 行額外要求在架樣本 ≥10，確保開價中位穩定。
  const MIN_SOLD = 20;
  const MIN_ASKING_N = 10;
  const qualifiedDistricts = useMemo(
    () => districts.filter((r) =>
      (r.sold_deals ?? 0) >= MIN_SOLD &&
      (r.method === "report" || (r.asking_n ?? 0) >= MIN_ASKING_N)
    ),
    [districts],
  );
  const activeListings = scrapeRows.reduce((s, r) => s + (r.asking_n ?? 0), 0);

  // 縣市排名（議價空間）
  const ranked = useMemo(
    () => [...nat].filter((d) => d.spread_pct != null).sort((a, b) => b.spread_pct - a.spread_pct),
    [nat],
  );
  const ccInfo = nat.find((d) => d.county_code === cc);
  const rankIdx = ranked.findIndex((d) => d.county_code === cc);
  const rankNote = rankIdx >= 0 ? `全台 ${ranked.length} 縣市議價空間第 ${rankIdx + 1} 大` : null;

  const sel = districts.find((r) => r.district === district) ?? null;

  const payload: BrokerBriefPayload | null = useMemo(() => {
    if (!sel) return null;
    return {
      generated_at: meta?.generated_at ?? "",
      audience,
      county: ccName,
      district: sel.district,
      evidence: {
        sold_median_ping_wan: wan(sel.sold_median_ping),
        asking_median_ping_wan: wan(sel.asking_median_ping),
        spread_pct: sel.spread_pct,
        listings_active: sel.method === "scrape" ? sel.asking_n : null,
        sold_deals: sel.sold_deals,
        method: sel.method,
      },
      county_context: { spread_pct: ccInfo?.spread_pct ?? null, rank_note: rankNote },
      instruction_hint:
        "Use only the provided district medians. These are not a single unit's price. Explain negotiation leverage and what to verify.",
    };
  }, [sel, audience, ccName, meta, ccInfo, rankNote]);

  const llmContract = useMemo(() => payload && ({
    messages: buildBrokerBriefMessages(payload),
    response_format: {
      type: "json_schema",
      json_schema: { name: "broker_brief", schema: brokerBriefResponseSchema, strict: true },
    },
  }), [payload]);

  const copyPayload = async () => {
    if (!payload) return;
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setCopied(true); window.setTimeout(() => setCopied(false), 1600);
  };
  const copyPrompt = async () => {
    if (!llmContract) return;
    await navigator.clipboard.writeText(JSON.stringify(llmContract, null, 2));
    setPromptCopied(true); window.setTimeout(() => setPromptCopied(false), 1600);
  };

  return (
    <div className="space-y-6">
      <RoleHero kicker="Agent's Desk · 業務模式" title="開價、在架、議價空間，一頁談案" img="/img/accent-seller.webp">
        站在<strong>仲介／銷售業務</strong>角度，把實價登錄的<strong>成交</strong>、售屋平台的<strong>開價</strong>與
        <strong>在架量</strong>聚成接案、訂牌價、談屋主／談買方的依據。選一個區，
        一鍵產出可交給 LLM 的<strong>委託說明</strong>或<strong>出價建議</strong>。
        開價資料目前<strong>深耕台南</strong>（實抓售屋平台），其他縣市以縣市議價率回推。
      </RoleHero>

      <KpiBar>
        <Kpi label={`${ccName} 議價空間`}
             value={ccInfo?.spread_pct != null ? `${(ccInfo.spread_pct * 100).toFixed(1)}%` : "—"}
             sub={rankNote ?? "縣市平均"} />
        <Kpi label="實抓開價區數" value={`${scrapeRows.length}`}
             sub={scrapeRows.length ? "區級實測議價空間" : "本縣市以議價率回推"}
             accent={scrapeRows.length ? "up" : "default"} />
        <Kpi label={`${ccName} 在架量`} value={activeListings ? activeListings.toLocaleString() : "—"}
             sub={activeListings ? "實抓售屋平台待售件數" : "暫無實抓"} />
        <Kpi label="可談區（有量）"
             value={qualifiedDistricts[0]?.district ?? "—"}
             sub={qualifiedDistricts[0]?.spread_pct != null
               ? `約 ${(qualifiedDistricts[0].spread_pct * 100).toFixed(1)}%（成交≥20）`
               : "需更多成交資料"} accent="up" />
      </KpiBar>

      {/* 選區 + 對象 */}
      <Section
        kicker="選一個區"
        title="產生委託簡報"
        right={
          <select className="input" value={cc} onChange={(e) => setCc(e.target.value)}>
            {counties.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <select className="input" value={district} onChange={(e) => setDistrict(e.target.value)}>
            <option value="">— 選擇鄉鎮市區 —</option>
            {districts.map((r) => {
              const thin = (r.sold_deals ?? 0) < MIN_SOLD ||
                (r.method === "scrape" && (r.asking_n ?? 0) < MIN_ASKING_N);
              return (
                <option key={r.district} value={r.district}>
                  {thin ? "⚠ " : ""}{r.district}（議價空間 {r.spread_pct != null ? `${(r.spread_pct * 100).toFixed(1)}%` : "—"}{thin ? "，少量樣本" : ""}）
                </option>
              );
            })}
          </select>
          <div className="inline-flex overflow-hidden rounded-md border border-ink-300">
            {(["owner", "buyer"] as const).map((a) => (
              <button key={a} onClick={() => setAudience(a)}
                className={`px-3 py-1.5 text-sm ${audience === a ? "bg-brass-500 text-white" : "bg-paper text-ink-600 hover:text-brass-700"}`}>
                {a === "owner" ? "給屋主（委託說明）" : "給買方（出價建議）"}
              </button>
            ))}
          </div>
        </div>

        {sel ? (
          <div className="mt-5 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <Metric label="成交中位" value={`${fmtPing(sel.sold_median_ping)} 萬/坪`} />
            <Metric label="開價中位" value={`${fmtPing(sel.asking_median_ping)} 萬/坪`}
                    tone={sel.method === "scrape" ? "up" : "default"} />
            <Metric label="議價空間" value={sel.spread_pct != null ? `${(sel.spread_pct * 100).toFixed(1)}%` : "—"} />
            <Metric label={sel.method === "scrape" ? "在架量" : "成交量"}
                    value={sel.method === "scrape"
                      ? `${(sel.asking_n ?? 0).toLocaleString()} 件`
                      : `${sel.sold_deals.toLocaleString()} 筆`} />
          </div>
        ) : (
          <p className="mt-4 text-sm text-ink-500">選一個區，下面會生成可交給 LLM 的委託簡報資料與 API 契約。</p>
        )}
      </Section>

      {/* LLM 契約輸出 */}
      {payload && (
        <Section
          kicker="AI-ready"
          title={audience === "owner" ? "委託說明（給屋主）資料摘要" : "出價建議（給買方）資料摘要"}
          right={<div className="flex gap-2">
            <button className="btn" onClick={copyPayload}>{copied ? "已複製" : "複製 JSON"}</button>
            <button className="btn" onClick={copyPrompt}>{promptCopied ? "已複製" : "複製 API 契約"}</button>
          </div>}
        >
          <p className="mb-3 text-sm text-ink-600 leading-7">
            這份 JSON 只含<strong>已驗證的區域中位證據</strong>（成交／開價／議價空間／在架量），
            並約束模型「只能用提供的證據、不得杜撰行情或個案」。複製後丟給 GPT/Claude，即可生成自然語言的
            {audience === "owner" ? "委託說明與訂價話術" : "出價建議與談判切入點"}。
          </p>
          <pre className="max-h-[360px] overflow-auto rounded-md bg-ink-900 p-4 text-xs leading-5 text-ink-50">
            {JSON.stringify(payload, null, 2)}
          </pre>
        </Section>
      )}

      <Section kicker="怎麼用" title="業務模式的眉角">
        <ul className="text-sm leading-7 text-ink-700 list-disc pl-5">
          <li><strong>議價空間大</strong>＝開價普遍高於成交，談屋主降價開價的空間大；但也可能是該區去化慢，需搭配<Link className="text-brass-700 underline" to="/spread">在架量</Link>一起看。</li>
          <li>標「<strong>實抓開價</strong>」的區是用實際蒐集的開價中位（區級、較準）；其餘為縣市議價率回推（同縣市各區一致）。</li>
          <li>所有數字是<strong>區域中位</strong>，<strong>不是</strong>任何單一物件——屋況、樓層、車位、急售與否影響很大，簡報請當佐證、非定價。</li>
          <li>成交資料來自內政部實價登錄；開價僅供市場參考，不構成訂價、出價或投資建議。</li>
        </ul>
      </Section>
    </div>
  );
}

function Metric({ label, value, tone = "default" }: {
  label: string; value: string; tone?: "up" | "down" | "default";
}) {
  const tc = tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-ink-900";
  return (
    <div className="rounded-md border border-ink-200 bg-paper/60 p-4">
      <div className="label mb-1">{label}</div>
      <div className={`stat-num text-lg font-medium ${tc}`}>{value}</div>
    </div>
  );
}
