export type BuyerReportPayload = {
  generated_at: string;
  data_version: string | null;
  last_deal_date: Record<string, string | null> | null;
  purpose: "buyer_area_report";
  items: Array<{
    county: string;
    district: string;
    score: number;
    median_unit_price_ping: number | null;
    median_total_price: number | null;
    deals_12m: number | null;
    momentum_6m: number | null;
    confidence: string | null;
    headline: string | null;
    strengths: string[];
    warnings: string[];
  }>;
  instruction_hint: string;
};

export function buildBuyerReportMessages(payload: BuyerReportPayload) {
  return [
    {
      role: "system",
      content: [
        "You are a Taiwan home-buying analysis assistant.",
        "Use only the supplied JSON evidence.",
        "Do not invent transactions, future prices, transport facts, school facts, or legal facts.",
        "When evidence is weak, say confidence is limited and explain why.",
        "Output practical trade-offs, negotiation angles, and what to verify before viewing or bidding.",
      ].join(" "),
    },
    {
      role: "user",
      content: JSON.stringify(payload, null, 2),
    },
  ];
}

/** 業務/仲介模式：把一個行政區的開價/成交/議價空間/在架量，產成一份談判用的「委託說明」或「出價建議」。 */
export type BrokerBriefPayload = {
  generated_at: string;
  audience: "owner" | "buyer";   // owner=給屋主的委託說明；buyer=給買方的出價建議
  county: string;
  district: string;
  evidence: {
    sold_median_ping_wan: number | null;    // 萬/坪 成交中位（實價登錄）
    asking_median_ping_wan: number | null;  // 萬/坪 開價中位（售屋平台 / 議價率回推）
    spread_pct: number | null;              // 0~1 議價空間 =(開價-成交)/開價
    listings_active: number | null;         // 在架量（待售物件數，實抓）
    sold_deals: number | null;              // 近期成交量
    method: "scrape" | "report";            // 開價來源：實抓 / 議價率回推
  };
  county_context: {
    spread_pct: number | null;              // 縣市平均議價空間
    rank_note: string | null;               // 例：「全台 22 縣市議價空間第 3 大」
  };
  instruction_hint: string;
};

export function buildBrokerBriefMessages(payload: BrokerBriefPayload) {
  const role = payload.audience === "owner"
    ? "You are advising a Taiwan property OWNER's listing agent. Goal: justify a realistic listing price and set negotiation expectations."
    : "You are advising a Taiwan home BUYER's agent. Goal: justify a fair offer and identify negotiation leverage.";
  return [
    {
      role: "system",
      content: [
        "You are a Taiwan real-estate negotiation assistant.",
        role,
        "Use ONLY the supplied JSON evidence (district medians, spread, active listings, deal count).",
        "Do not invent specific transactions, addresses, future prices, school or transit facts.",
        "These are DISTRICT-LEVEL medians, not a specific unit; always note that condition/floor/parking/urgency move the real number.",
        "When the open-price source is 'report' (derived from an average negotiation rate), say the spread is a county-level estimate.",
        "Output concrete, client-facing talking points in Traditional Chinese.",
      ].join(" "),
    },
    { role: "user", content: JSON.stringify(payload, null, 2) },
  ];
}

export const brokerBriefResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "summary", "talking_points", "suggested_action", "caveats", "disclaimer"],
  properties: {
    headline: { type: "string" },
    summary: { type: "string" },
    talking_points: { type: "array", items: { type: "string" } },
    suggested_action: { type: "string" },     // 建議開價 / 出價區間的說法
    caveats: { type: "array", items: { type: "string" } },
    disclaimer: { type: "string" },
  },
} as const;

export const buyerReportResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "ranking", "risks", "next_checks", "disclaimer"],
  properties: {
    summary: { type: "string" },
    ranking: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["district", "recommendation", "reason", "confidence"],
        properties: {
          district: { type: "string" },
          recommendation: { type: "string" },
          reason: { type: "string" },
          confidence: { type: "string" },
        },
      },
    },
    risks: { type: "array", items: { type: "string" } },
    next_checks: { type: "array", items: { type: "string" } },
    disclaimer: { type: "string" },
  },
} as const;
