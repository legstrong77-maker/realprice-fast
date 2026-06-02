import type { HeatmapRow, MomentumRow, POI } from "./data";
import { fmt, fmtPct, fmtPing, fmtWan } from "./format";
import { getCentroid } from "./districtCentroids";

export type AreaSignal = {
  label: string;
  value: string;
  tone?: "up" | "down" | "default";
};

export type AreaNarrative = {
  headline: string;
  confidence: "高" | "中" | "低";
  signals: AreaSignal[];
  notes: string[];
  warnings: string[];
};

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function poiCountsNear(
  cc: string,
  district: string,
  pois: Record<"stations" | "schools" | "nimby", POI[]>,
  radiusKm = 1.2,
) {
  const centerTuple = getCentroid(cc, district);
  if (!centerTuple) return { stations: 0, schools: 0, nimby: 0 };
  const center = { lng: centerTuple[0], lat: centerTuple[1] };
  return {
    stations: pois.stations.filter((p) => distanceKm(center, p) <= radiusKm).length,
    schools: pois.schools.filter((p) => distanceKm(center, p) <= radiusKm).length,
    nimby: pois.nimby.filter((p) => distanceKm(center, p) <= radiusKm).length,
  };
}

export function buildAreaNarrative(input: {
  row: HeatmapRow;
  momentum?: MomentumRow;
  countyMedian?: number | null;
  poi?: { stations: number; schools: number; nimby: number };
}): AreaNarrative {
  const { row, momentum, countyMedian, poi } = input;
  const notes: string[] = [];
  const warnings: string[] = [];
  const priceRatio = countyMedian && row.median_unit_price_ping
    ? row.median_unit_price_ping / countyMedian
    : null;

  if ((row.deals ?? 0) >= 120) notes.push("成交量充足，較容易找到可比案例。");
  else if ((row.deals ?? 0) >= 50) notes.push("成交量中等，可作為初步行情參考。");
  else warnings.push("成交樣本偏少，單一物件可能影響中位價。");

  if (priceRatio != null && priceRatio < 0.9) notes.push("價格低於縣市均衡，適合預算型買方優先研究。");
  if (priceRatio != null && priceRatio > 1.2) warnings.push("價格高於縣市均衡，需確認地段、屋況或交通優勢是否足夠。");

  if (momentum?.pct_change != null && momentum.pct_change > 0.15) warnings.push("近半年漲幅偏快，追價前要看原始成交組成。");
  else if (momentum?.pct_change != null && momentum.pct_change < -0.12) warnings.push("近半年價格回落，議價空間可能增加，但需查供給與利空。");
  else if (momentum?.pct_change != null) notes.push("近半年動能溫和，較適合用分位區間談價。");

  if (poi) {
    if (poi.stations >= 2) notes.push("區中心附近交通節點密度佳。");
    if (poi.schools >= 3) notes.push("學校資源密集，適合重視家庭生活圈的買方。");
    if (poi.nimby >= 3) warnings.push("區中心附近嫌惡設施較多，需確認實際距離與風向/噪音。");
  }

  const confidence =
    (row.deals ?? 0) >= 120 ? "高" :
    (row.deals ?? 0) >= 50 ? "中" :
    "低";
  const headline =
    warnings.length >= 2 ? "可看，但要嚴格查證" :
    priceRatio != null && priceRatio < 0.9 && (row.deals ?? 0) >= 50 ? "預算友善，值得列入候選" :
    momentum?.pct_change != null && momentum.pct_change > 0.12 ? "熱度偏高，避免追價" :
    "行情穩定，適合深入比價";

  return {
    headline,
    confidence,
    signals: [
      { label: "中位單價", value: `${fmtPing(row.median_unit_price_ping)} 萬/坪` },
      { label: "中位總價", value: `${fmtWan(row.median_total_price)} 萬` },
      { label: "近 12 月成交", value: `${fmt(row.deals)} 筆`, tone: (row.deals ?? 0) >= 80 ? "up" : "default" },
      { label: "近半年動能", value: fmtPct(momentum?.pct_change), tone: (momentum?.pct_change ?? 0) > 0 ? "up" : "down" },
    ],
    notes,
    warnings,
  };
}
