/** 從 /data/snapshots/ 讀靜態 JSON。
 *  dev 下 vite serve public/，prod 下用 CDN。
 *  全部走 fetch + 瀏覽器 cache，沒有 API server。
 */

const BASE = (import.meta as any).env?.VITE_DATA_BASE ?? "/data";

const memCache = new Map<string, Promise<any>>();

async function fetchJSON<T = any>(path: string): Promise<T> {
  const url = `${BASE}${path}`;
  if (memCache.has(url)) return memCache.get(url)!;
  const p = fetch(url, { credentials: "omit" }).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.json() as Promise<T>;
  });
  // 失敗就把 cache 撤掉，避免一次失敗永久卡住
  p.catch(() => memCache.delete(url));
  memCache.set(url, p);
  return p;
}

export type DealKind = "sale" | "presale" | "rent";

export interface Meta {
  generated_at: string;
  counties: { code: string; name: string }[];
  districts: Record<string, string[]>;
  building_types: { name: string; count: number }[];
  last_deal_date: Record<DealKind, string | null>;
  deal_kinds: DealKind[];
}

export interface CountySummary {
  county_code: string;
  county_name: string;
  total_deals: number;
  last_deal_date: string | null;
  avg_unit_price_ping: number | null;
  median_unit_price_ping: number | null;
  avg_total_price: number | null;
  median_total_price: number | null;
}

export interface HeatmapRow {
  district: string;
  deals: number;
  median_unit_price_ping: number | null;
  avg_unit_price_ping: number | null;
  median_total_price: number | null;
}

export interface MomentumRow {
  district: string;
  p_now: number | null;
  p_prev: number | null;
  n_now: number | null;
  n_prev: number | null;
  pct_change: number | null;
}

export interface MonthlyRow {
  month: string;
  deals: number;
  median_unit_price_ping: number | null;
  avg_unit_price_ping: number | null;
  median_total_price: number | null;
}

export interface DistributionPayload {
  stats: {
    n: number;
    p10: number; p25: number; p50: number; p75: number; p90: number;
    mean: number;
  };
  bins: { bin_idx: number; n: number; lo: number; hi: number }[];
}

export interface BuildingTypeRow {
  building_type: string;
  deals: number;
  median_unit_price_ping: number | null;
  avg_unit_price_ping: number | null;
  median_total_price: number | null;
  avg_building_area_sqm: number | null;
  avg_age_years: number | null;
}

export interface AgeBucketRow {
  bucket: string;
  deals: number;
  median_unit_price_ping: number | null;
  median_total_price: number | null;
  avg_building_area_sqm: number | null;
}

export interface SizeBucketRow {
  bucket: string;
  deals: number;
  median_unit_price_ping: number | null;
  median_total_price: number | null;
  avg_age_years: number | null;
}

export interface RoadRow {
  district: string;
  road: string;
  deals: number;
  median_unit_price_ping: number | null;
  avg_unit_price_ping: number | null;
  median_total_price: number | null;
  last_deal_date: string | null;
  lat: number | null;
  lng: number | null;
}

export interface RecentRow {
  serial_no: string;
  county_code: string;
  district: string;
  address: string | null;
  road: string | null;
  building_type: string | null;
  total_floors: number | null;
  transfer_floor_num: number | null;
  age_years: number | null;
  rooms: number | null;
  halls: number | null;
  baths: number | null;
  building_area_sqm: number | null;
  total_price: number | null;
  unit_price_per_ping: number | null;
  deal_date: string;
  is_special_deal: boolean;
  note: string | null;
}

export interface EstimatorRow {
  district: string;
  building_type: string;
  area_bucket: string;        // A_lt15 | B_15_25 | C_25_35 | D_35_50 | E_50_70 | F_gt70
  n: number;
  p25: number;
  p50: number;
  p75: number;
  mean: number;
  avg_age: number | null;
  median_total_price: number | null;
}

export interface UnderpricedRow {
  serial_no: string;
  district: string;
  address: string | null;
  road: string | null;
  building_type: string | null;
  total_floors: number | null;
  transfer_floor_num: number | null;
  age_years: number | null;
  rooms: number | null;
  halls: number | null;
  baths: number | null;
  building_area_sqm: number | null;
  total_price: number | null;
  unit_price_per_ping: number | null;
  deal_date: string;
  region_p25: number;
  price_ratio: number;        // unit_price / region_p25
}

export interface RoadHistoryDeal {
  district: string;
  address: string | null;
  building_type: string | null;
  total_floors: number | null;
  transfer_floor_num: number | null;
  age_years: number | null;
  rooms: number | null;
  halls: number | null;
  baths: number | null;
  building_area_sqm: number | null;
  total_price: number | null;
  unit_price_per_ping: number | null;
  deal_date: string;
  is_special_deal: boolean;
}

export const data = {
  meta:        () => fetchJSON<Meta>("/meta.json"),
  countySummary: () => fetchJSON<Record<DealKind, CountySummary[]>>("/county-summary.json"),
  heatmap:     (cc: string, dk: DealKind) => fetchJSON<HeatmapRow[]>(`/heatmap/${cc}-${dk}.json`),
  momentum:    (cc: string, dk: DealKind) => fetchJSON<MomentumRow[]>(`/momentum/${cc}-${dk}.json`),
  monthly:     (cc: string, district: string, dk: DealKind) =>
                 fetchJSON<MonthlyRow[]>(`/district-monthly/${cc}-${district}-${dk}.json`),
  distribution: (cc: string, dk: DealKind) =>
                 fetchJSON<DistributionPayload>(`/distribution/${cc}-${dk}.json`),
  recent:      (cc: string, dk: DealKind) => fetchJSON<RecentRow[]>(`/recent/${cc}-${dk}.json`),
  buildingType: (cc: string, dk: DealKind) =>
                  fetchJSON<BuildingTypeRow[]>(`/building-type/${cc}-${dk}.json`),
  ageBuckets:  (cc: string) => fetchJSON<AgeBucketRow[]>(`/age-buckets/${cc}.json`),
  sizeBuckets: (cc: string) => fetchJSON<SizeBucketRow[]>(`/size-buckets/${cc}.json`),
  roads:       (cc: string, dk: DealKind) => fetchJSON<RoadRow[]>(`/roads/${cc}-${dk}.json`),
  estimator:   (cc: string) => fetchJSON<EstimatorRow[]>(`/estimator/${cc}.json`),
  underpriced: (cc: string) => fetchJSON<UnderpricedRow[]>(`/underpriced/${cc}.json`),
  roadHistory: (cc: string) =>
                  fetchJSON<Record<string, RoadHistoryDeal[]>>(`/road-history/${cc}.json`),
};
