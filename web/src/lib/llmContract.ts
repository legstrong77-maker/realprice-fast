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
