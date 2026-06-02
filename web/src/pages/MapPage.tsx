import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  data, type DealKind, type HeatmapRow, type Meta, type RecentRow, type RoadRow, type POI,
} from "../lib/data";
import { fmt, fmtPing, fmtWan } from "../lib/format";
import { getCentroid } from "../lib/districtCentroids";
import DealKindTabs from "../components/DealKindTabs";
import { addShortlist, isShortlisted } from "../lib/shortlist";
import { buildAreaNarrative, poiCountsNear } from "../lib/analysis";

// 全台 22 縣市地圖中心
const COUNTY_VIEW: Record<string, { center: [number, number]; zoom: number }> = {
  // 六都
  a: { center: [121.5440, 25.0445], zoom: 11.4 },   // 臺北市
  f: { center: [121.4750, 25.0140], zoom: 10.6 },   // 新北市
  h: { center: [121.2070, 24.9400], zoom: 10.0 },   // 桃園市
  b: { center: [120.6800, 24.1400], zoom: 10.5 },   // 臺中市
  d: { center: [120.2280, 23.0400], zoom: 10.0 },   // 臺南市
  e: { center: [120.3110, 22.6300], zoom: 9.6 },    // 高雄市
  // 省轄市
  c: { center: [121.7400, 25.1300], zoom: 12.0 },   // 基隆市
  o: { center: [120.9700, 24.8050], zoom: 12.0 },   // 新竹市
  i: { center: [120.4500, 23.4800], zoom: 12.4 },   // 嘉義市
  // 縣
  g: { center: [121.7560, 24.7000], zoom: 9.8 },    // 宜蘭縣
  j: { center: [121.0500, 24.7000], zoom: 9.8 },    // 新竹縣
  k: { center: [120.9000, 24.5000], zoom: 9.8 },    // 苗栗縣
  m: { center: [120.8500, 23.7800], zoom: 9.4 },    // 南投縣
  n: { center: [120.5000, 24.0000], zoom: 10.0 },   // 彰化縣
  p: { center: [120.4500, 23.7000], zoom: 9.8 },    // 雲林縣
  q: { center: [120.4000, 23.4500], zoom: 9.4 },    // 嘉義縣
  t: { center: [120.5500, 22.5500], zoom: 9.0 },    // 屏東縣
  u: { center: [121.5000, 23.7000], zoom: 8.6 },    // 花蓮縣
  v: { center: [121.0000, 22.9000], zoom: 8.6 },    // 臺東縣
  // 外島
  w: { center: [118.3300, 24.4500], zoom: 11.4 },   // 金門縣
  x: { center: [119.6000, 23.5500], zoom: 10.6 },   // 澎湖縣
  z: { center: [119.9500, 26.1500], zoom: 11.4 },   // 連江縣
};

const ROAD_ZOOM_THRESHOLD = 13;   // ≥ 13 顯示路段點

type Picked =
  | { kind: "district"; row: HeatmapRow }
  | { kind: "road"; row: RoadRow }
  | { kind: "poi"; row: POI; layer: PoiLayer }
  | null;

type PoiLayer = "stations" | "schools" | "nimby";

// 把 cc/dk/picked 同步到 URL hash，讓使用者能複製連結分享當前視角
function readUrlState(): {
  cc: string;
  dk: DealKind;
  pickD?: string;
  pickR?: string;
} {
  const hash = typeof window === "undefined" ? "" : window.location.hash.slice(1);
  const p = new URLSearchParams(hash);
  const cc = p.get("cc") || "a";
  const dkRaw = p.get("dk");
  const dk: DealKind = dkRaw === "rent" || dkRaw === "presale" ? dkRaw : "sale";
  return {
    cc,
    dk,
    pickD: p.get("d") || undefined,
    pickR: p.get("r") || undefined,
  };
}

function writeUrlState(cc: string, dk: DealKind, picked: Picked) {
  if (typeof window === "undefined") return;
  const p = new URLSearchParams();
  p.set("cc", cc);
  p.set("dk", dk);
  if (picked?.kind === "district") p.set("d", picked.row.district);
  else if (picked?.kind === "road") p.set("r", picked.row.road);
  const next = "#" + p.toString();
  if (next !== window.location.hash) {
    window.history.replaceState(null, "", next);
  }
}

const POI_STYLE: Record<PoiLayer, {
  label: string;
  color: string;
  icon: string;
  source: string;
}> = {
  stations: { label: "車站", color: "#b8862c", icon: "🚇", source: "stations" },
  schools:  { label: "學校", color: "#047857", icon: "🎓", source: "schools" },
  nimby:    { label: "嫌惡設施", color: "#b91c1c", icon: "⚠", source: "nimby" },
};

/** 國土測繪中心（NLSC）免申請 WMTS — 全國級圖磚，GoogleMapsCompatible。 */
const nlsc = (layer: string) =>
  `https://wmts.nlsc.gov.tw/wmts/${layer}/default/GoogleMapsCompatible/{z}/{y}/{x}`;

type BasemapId = "osm" | "emap" | "photo";
const BASEMAPS: { id: BasemapId; label: string; icon: string; tiles: string; attribution: string }[] = [
  { id: "osm",   label: "街道",   icon: "🗺", tiles: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: "© OpenStreetMap contributors" },
  { id: "emap",  label: "電子地圖", icon: "🧭", tiles: nlsc("EMAP"),   attribution: "© 內政部國土測繪中心 NLSC" },
  { id: "photo", label: "航照影像", icon: "🛰", tiles: nlsc("PHOTO2"), attribution: "© 內政部國土測繪中心 NLSC" },
];

type OverlayId = "luimap" | "landsect";
const OVERLAYS: { id: OverlayId; label: string; tiles: string; desc: string }[] = [
  { id: "luimap",   label: "土地使用", tiles: nlsc("LUIMAP"),   desc: "國土利用現況（住/商/工/農 概況）" },
  { id: "landsect", label: "地籍圖",   tiles: nlsc("LANDSECT"), desc: "宗地界線（放大後較清楚）" },
];

export default function MapPage({ meta }: { meta: Meta | null }) {
  // 讀 URL 初始狀態（refresh / 分享連結進來會還原視角）
  const initial = useRef(readUrlState());
  const [cc, setCc] = useState(initial.current.cc);
  const [dk, setDk] = useState<DealKind>(initial.current.dk);
  const [heatmap, setHeatmap] = useState<HeatmapRow[]>([]);
  const [roads, setRoads] = useState<RoadRow[]>([]);
  const [recent, setRecent] = useState<RecentRow[]>([]);
  const [picked, setPicked] = useState<Picked>(null);
  const [zoom, setZoom] = useState((COUNTY_VIEW[initial.current.cc] ?? COUNTY_VIEW.a).zoom);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [budgetWan, setBudgetWan] = useState(1600);
  const [areaPing, setAreaPing] = useState(30);
  // URL 上 d=/r= 等資料載入後才能套用，先放這裡
  const pendingPick = useRef<{ d?: string; r?: string } | null>(
    initial.current.pickD || initial.current.pickR
      ? { d: initial.current.pickD, r: initial.current.pickR }
      : null
  );

  // POI 圖層
  const [pois, setPois] = useState<Record<PoiLayer, POI[]>>({
    stations: [], schools: [], nimby: [],
  });
  const [poiOn, setPoiOn] = useState<Record<PoiLayer, boolean>>({
    stations: false, schools: false, nimby: false,
  });

  // 政府圖磚：底圖切換 + 疊圖開關 + 透明度
  const [basemap, setBasemap] = useState<BasemapId>("osm");
  const [overlayOn, setOverlayOn] = useState<Record<OverlayId, boolean>>({ luimap: false, landsect: false });
  const [overlayOpacity, setOverlayOpacity] = useState(0.6);

  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const poiLayerInitRef = useRef(false);
  const rasterInitRef = useRef(false);

  const counties = meta?.counties ?? [];
  const countyName = counties.find(c => c.code === cc)?.name ?? cc;

  // 抓 heatmap + roads + 該縣市近期成交（給「縮小看賣房紀錄」用）
  useEffect(() => {
    setPicked(null);
    data.heatmap(cc, dk).then(setHeatmap).catch(() => setHeatmap([]));
    data.roads(cc, dk).then(setRoads).catch(() => setRoads([]));
    data.recent(cc, dk).then(setRecent).catch(() => setRecent([]));
  }, [cc, dk]);

  // 從 URL 還原 picked：等 heatmap / roads 載完才能套用
  useEffect(() => {
    const p = pendingPick.current;
    if (!p) return;
    if (p.r && roads.length > 0) {
      const row = roads.find(r => r.road === p.r);
      if (row) {
        setPicked({ kind: "road", row });
        if (row.lat != null && row.lng != null) {
          mapRef.current?.flyTo({ center: [row.lng, row.lat], zoom: 15.5, speed: 1.6 });
        }
        pendingPick.current = null;
        return;
      }
    }
    if (p.d && heatmap.length > 0) {
      const row = heatmap.find(h => h.district === p.d);
      if (row) {
        setPicked({ kind: "district", row });
        pendingPick.current = null;
      }
    }
  }, [heatmap, roads]);

  // 把 cc / dk / picked 寫回 URL hash（複製連結即可分享當前視角）
  useEffect(() => {
    writeUrlState(cc, dk, picked);
  }, [cc, dk, picked]);

  // 瀏覽器上一頁/下一頁按鈕：重新讀 URL 套用
  useEffect(() => {
    const onPop = () => {
      const next = readUrlState();
      setCc(next.cc);
      setDk(next.dk);
      pendingPick.current = next.pickD || next.pickR
        ? { d: next.pickD, r: next.pickR }
        : null;
      if (!next.pickD && !next.pickR) setPicked(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // 抓 POI（懶載入：toggle 開了才抓）
  useEffect(() => {
    (Object.keys(poiOn) as PoiLayer[]).forEach((k) => {
      if (poiOn[k] && pois[k].length === 0) {
        data.pois(k).then((rows) => setPois((p) => ({ ...p, [k]: rows }))).catch(() => {});
      }
    });
  }, [poiOn]);

  // 行政區詳情需要 POI 摘要時，背景載入一次，不強迫使用者先開圖層。
  useEffect(() => {
    if (picked?.kind !== "district") return;
    (Object.keys(pois) as PoiLayer[]).forEach((k) => {
      if (pois[k].length === 0) {
        data.pois(k).then((rows) => setPois((p) => ({ ...p, [k]: rows }))).catch(() => {});
      }
    });
  }, [picked, pois]);

  // 初始化地圖
  useEffect(() => {
    if (!container.current || mapRef.current) return;
    const view = COUNTY_VIEW[initial.current.cc] ?? COUNTY_VIEW.a;
    const map = new maplibregl.Map({
      container: container.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: view.center,
      zoom: view.zoom,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({}), "top-right");
    map.on("zoom", () => setZoom(map.getZoom()));
    // 等 style 載完再加 政府圖磚 + POI source/layer
    map.on("load", () => {
      // —— 政府底圖（NLSC WMTS）：emap / photo（osm 已在 style 內），預設隱藏 ——
      BASEMAPS.filter(b => b.id !== "osm").forEach((b) => {
        map.addSource(`base-${b.id}`, {
          type: "raster", tiles: [b.tiles], tileSize: 256, attribution: b.attribution, maxzoom: 20,
        });
        map.addLayer({
          id: `base-${b.id}`, type: "raster", source: `base-${b.id}`,
          layout: { visibility: "none" },
        });
      });
      // —— 政府疊圖（NLSC WMTS）：土地使用 / 地籍，預設隱藏 ——
      OVERLAYS.forEach((o) => {
        map.addSource(`ov-${o.id}`, {
          type: "raster", tiles: [o.tiles], tileSize: 256, attribution: "© 內政部國土測繪中心 NLSC", maxzoom: 20,
        });
        map.addLayer({
          id: `ov-${o.id}`, type: "raster", source: `ov-${o.id}`,
          layout: { visibility: "none" }, paint: { "raster-opacity": 0.6 },
        });
      });
      rasterInitRef.current = true;

      (Object.keys(POI_STYLE) as PoiLayer[]).forEach((k) => {
        const style = POI_STYLE[k];
        map.addSource(style.source, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: `${style.source}-circle`,
          type: "circle",
          source: style.source,
          paint: {
            "circle-radius": [
              "interpolate", ["linear"], ["zoom"],
              9, 3,
              13, 6,
              16, 9,
            ],
            "circle-color": style.color,
            "circle-opacity": 0.85,
            "circle-stroke-color": "#fff",
            "circle-stroke-width": 1.5,
          },
        });
        map.addLayer({
          id: `${style.source}-label`,
          type: "symbol",
          source: style.source,
          minzoom: 14,
          layout: {
            "text-field": ["get", "name"],
            "text-size": 11,
            "text-offset": [0, 1.1],
            "text-anchor": "top",
            "text-font": ["Noto Sans Regular"],
            "text-allow-overlap": false,
          },
          paint: {
            "text-color": style.color,
            "text-halo-color": "#fff",
            "text-halo-width": 1.6,
          },
        });
        // click handler
        map.on("click", `${style.source}-circle`, (e: any) => {
          const f = e.features?.[0];
          if (!f) return;
          setPicked({
            kind: "poi",
            layer: k,
            row: {
              name: f.properties.name,
              subtype: f.properties.subtype,
              lat: f.geometry.coordinates[1],
              lng: f.geometry.coordinates[0],
            },
          });
        });
        map.on("mouseenter", `${style.source}-circle`, () => map.getCanvas().style.cursor = "pointer");
        map.on("mouseleave", `${style.source}-circle`, () => map.getCanvas().style.cursor = "");
      });
      poiLayerInitRef.current = true;
    });
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // 同步 POI 資料 + 顯示狀態 → map source / layer visibility
  useEffect(() => {
    const m = mapRef.current; if (!m || !poiLayerInitRef.current) return;
    (Object.keys(POI_STYLE) as PoiLayer[]).forEach((k) => {
      const style = POI_STYLE[k];
      const features = poiOn[k] ? pois[k].map(p => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
        properties: { name: p.name, subtype: p.subtype },
      })) : [];
      const src = m.getSource(style.source) as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData({ type: "FeatureCollection", features });
      const vis = poiOn[k] ? "visible" : "none";
      if (m.getLayer(`${style.source}-circle`)) m.setLayoutProperty(`${style.source}-circle`, "visibility", vis);
      if (m.getLayer(`${style.source}-label`)) m.setLayoutProperty(`${style.source}-label`, "visibility", vis);
    });
  }, [pois, poiOn, zoom]);

  // 底圖切換：只顯示選中的那層
  useEffect(() => {
    const m = mapRef.current; if (!m || !rasterInitRef.current) return;
    BASEMAPS.forEach((b) => {
      const id = b.id === "osm" ? "osm" : `base-${b.id}`;
      if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", b.id === basemap ? "visible" : "none");
    });
  }, [basemap]);

  // 疊圖開關 + 透明度
  useEffect(() => {
    const m = mapRef.current; if (!m || !rasterInitRef.current) return;
    OVERLAYS.forEach((o) => {
      const id = `ov-${o.id}`;
      if (!m.getLayer(id)) return;
      m.setLayoutProperty(id, "visibility", overlayOn[o.id] ? "visible" : "none");
      m.setPaintProperty(id, "raster-opacity", overlayOpacity);
    });
  }, [overlayOn, overlayOpacity]);

  // 切縣市時飛過去
  useEffect(() => {
    const m = mapRef.current; if (!m) return;
    const v = COUNTY_VIEW[cc] ?? COUNTY_VIEW.a;
    m.flyTo({ center: v.center, zoom: v.zoom, speed: 1.4 });
  }, [cc]);

  // 顏色映射 (低=cyan700, 中=amber600, 高=red700)
  const districtStats = useMemo(() => priceRange(heatmap.map(h => h.median_unit_price_ping)), [heatmap]);
  const roadStats = useMemo(() => priceRange(roads.map(r => r.median_unit_price_ping)), [roads]);

  // 用路段資料反推每個區「成交實際集中點」當泡泡座標 — 比硬編 centroid 準
  // 加權：以該路段的成交筆數做權重。沒路段資料時 fallback 到硬編。
  // 路名 / 地址搜尋：對 roads + recent 都做 substring 比對
  type SearchHit =
    | { kind: "road"; row: RoadRow }
    | { kind: "deal"; row: RecentRow };

  const searchResults = useMemo<SearchHit[]>(() => {
    const q = search.trim();
    if (q.length < 1) return [];
    // 全形/半形數字、空白、區字通通拿掉，提升模糊匹配率
    const norm = (s: string) => s.replace(/\s+/g, "").replace(/區/g, "");
    const qn = norm(q);
    // 使用者打了數字（門牌號）→ 優先比對 recent address
    const queryHasNumber = /\d/.test(q);

    type Scored = { hit: SearchHit; score: number };
    const out: Scored[] = [];

    // 路段層級
    for (const r of roads) {
      if (r.lat == null || r.lng == null) continue;
      const idx = norm(r.road).indexOf(qn);
      if (idx < 0) continue;
      // 路段比對：越前面命中越前、成交越多越前
      let score = idx * 1000 - r.deals;
      if (queryHasNumber) score += 500; // 含數字時降低路段優先順序
      out.push({ hit: { kind: "road", row: r }, score });
    }

    // 個別交易層級（門牌級）— 只在有 lat/lng 的才能 fly-to
    for (const d of recent) {
      if (d.lat == null || d.lng == null) continue;
      const addr = d.address || d.road;
      if (!addr) continue;
      const idx = norm(addr).indexOf(qn);
      if (idx < 0) continue;
      let score = idx * 1000 + 1; // deal 預設稍微低於同位址路段
      if (queryHasNumber) score -= 1500; // 含數字時門牌大幅優先
      out.push({ hit: { kind: "deal", row: d }, score });
    }

    // 同地址多筆成交去重：保留 score 最低（最相關）
    const seen = new Map<string, Scored>();
    for (const s of out) {
      const k = s.hit.kind === "road"
        ? `R:${s.hit.row.road}`
        : `D:${(s.hit.row.address ?? s.hit.row.road)}`;
      const prev = seen.get(k);
      if (!prev || s.score < prev.score) seen.set(k, s);
    }

    return [...seen.values()]
      .sort((a, b) => a.score - b.score)
      .slice(0, 12)
      .map(x => x.hit);
  }, [search, roads, recent]);

  // 點搜尋結果 → flyTo + 設成對應 picked
  const handleSearchSelect = (hit: SearchHit) => {
    if (hit.kind === "road") {
      const r = hit.row;
      if (r.lat == null || r.lng == null) return;
      setPicked({ kind: "road", row: r });
      mapRef.current?.flyTo({ center: [r.lng, r.lat], zoom: 15.5, speed: 1.6 });
      setSearch(r.road);
    } else {
      const d = hit.row;
      if (d.lat == null || d.lng == null) return;
      // 嘗試把對應路段也 pin 上去（這樣右側 panel 會列同路段成交）
      const rr = roads.find(x => x.road === d.road);
      if (rr) setPicked({ kind: "road", row: rr });
      mapRef.current?.flyTo({ center: [d.lng, d.lat], zoom: 17, speed: 1.6 });
      setSearch(d.address ?? d.road ?? "");
    }
    setSearchOpen(false);
  };

  const districtCenters = useMemo(() => {
    const acc: Record<string, { sumLng: number; sumLat: number; sumW: number }> = {};
    roads.forEach(r => {
      if (r.lat == null || r.lng == null) return;
      const w = r.deals || 1;
      if (!acc[r.district]) acc[r.district] = { sumLng: 0, sumLat: 0, sumW: 0 };
      acc[r.district].sumLng += r.lng * w;
      acc[r.district].sumLat += r.lat * w;
      acc[r.district].sumW += w;
    });
    const out: Record<string, [number, number]> = {};
    Object.entries(acc).forEach(([d, o]) => {
      if (o.sumW > 0) out[d] = [o.sumLng / o.sumW, o.sumLat / o.sumW];
    });
    return out;
  }, [roads]);

  // 切換 zoom + 重畫 markers
  useEffect(() => {
    const m = mapRef.current; if (!m) return;
    markersRef.current.forEach(mk => mk.remove());
    markersRef.current = [];

    const showRoads = zoom >= ROAD_ZOOM_THRESHOLD;
    const pickedDistrict = picked?.kind === "district" ? picked.row.district : null;
    if (showRoads) {
      // 路段層 — 若已挑選某區，只顯示該區的路段，避免別區的標籤干擾
      const visible = roads.filter(r =>
        r.lat != null && r.lng != null &&
        (!pickedDistrict || r.district === pickedDistrict)
      );
      const dealMin = Math.min(...visible.map(r => r.deals), 1);
      const dealMax = Math.max(...visible.map(r => r.deals), 1);
      visible.forEach(r => {
        const size = 18 + Math.round(Math.sqrt((r.deals - dealMin) / Math.max(1, dealMax - dealMin)) * 22);
        const color = colorFor(r.median_unit_price_ping, roadStats);
        const priceText = r.median_unit_price_ping ? `${(r.median_unit_price_ping / 10000).toFixed(0)}萬` : "—";
        const wrap = document.createElement("div");
        wrap.style.cssText = `width:${size}px;height:${size}px;cursor:pointer;`;
        const el = document.createElement("div");
        el.style.cssText = `
          width:100%;height:100%;border-radius:9999px;
          background:${color};opacity:.9;border:1.5px solid white;
          box-shadow:0 1px 6px rgba(0,0,0,.25);
          display:flex;align-items:center;justify-content:center;
          color:white;font:600 ${Math.max(9, size/3.6)}px 'JetBrains Mono',monospace;
          transition:transform .12s,box-shadow .12s;will-change:transform;
        `;
        el.textContent = priceText;
        wrap.appendChild(el);
        // hover tooltip
        const tip = document.createElement("div");
        tip.style.cssText = `
          position:absolute;left:50%;top:-8px;transform:translate(-50%,-100%);
          background:#1c1813;color:#fff;padding:6px 10px;border-radius:6px;
          font:500 12px Inter,'Noto Sans TC',sans-serif;white-space:nowrap;
          box-shadow:0 4px 14px rgba(0,0,0,.3);pointer-events:none;
          opacity:0;transition:opacity .12s;
        `;
        tip.textContent = `${r.road} · ${r.deals} 筆 · 中位 ${priceText}/坪`;
        wrap.style.position = "relative";
        wrap.appendChild(tip);

        wrap.onmouseenter = () => {
          el.style.transform = "scale(1.18)";
          el.style.boxShadow = "0 4px 16px rgba(0,0,0,.4)";
          tip.style.opacity = "1";
          wrap.style.zIndex = "5";
        };
        wrap.onmouseleave = () => {
          el.style.transform = "scale(1)";
          el.style.boxShadow = "0 1px 6px rgba(0,0,0,.25)";
          tip.style.opacity = "0";
          wrap.style.zIndex = "";
        };
        wrap.onclick = () => setPicked({ kind: "road", row: r });

        const marker = new maplibregl.Marker({ element: wrap, anchor: "center" })
          .setLngLat([r.lng!, r.lat!])
          .addTo(m);
        markersRef.current.push(marker);
      });
    } else {
      // 鄉鎮層
      heatmap.forEach((row) => {
        const ll = districtCenters[row.district] ?? getCentroid(cc, row.district);
        if (!ll) return;
        const dealMax = Math.max(...heatmap.map(h => h.deals ?? 0), 1);
        const t = (row.deals ?? 0) / dealMax;
        // 縮愈遠泡泡愈小，避免低 zoom 時泡泡蓋滿地圖、擠到鄰區
        const zoomScale = Math.min(1, Math.max(0.55, (zoom - 7) / 5));
        const size = Math.max(40, Math.round((36 + Math.sqrt(t) * 46) * zoomScale));
        const color = colorFor(row.median_unit_price_ping, districtStats);
        const priceWan = row.median_unit_price_ping ? row.median_unit_price_ping / 10000 : null;
        const priceText = priceWan != null ? `${priceWan.toFixed(0)}萬` : "—";

        const wrap = document.createElement("div");
        wrap.style.cssText = `width:${size}px;height:${size}px;cursor:pointer;`;
        const el = document.createElement("div");
        el.style.cssText = `
          width:100%;height:100%;border-radius:9999px;
          background:${color};opacity:.88;border:2px solid white;
          box-shadow:0 2px 10px rgba(0,0,0,.22);
          display:flex;flex-direction:column;align-items:center;justify-content:center;
          color:white;line-height:1.05;text-align:center;
          font-family:Inter,'Noto Sans TC',sans-serif;
          transition:transform .12s,box-shadow .12s;will-change:transform;
        `;
        el.innerHTML = `
          <span style="font-size:${Math.max(11, size/6)}px;font-weight:600">${row.district.replace("區","")}</span>
          <span style="font-size:${Math.max(13, size/4.6)}px;font-weight:700;font-family:'JetBrains Mono',monospace;margin-top:2px">${priceText}</span>
        `;
        wrap.appendChild(el);
        wrap.onmouseenter = () => {
          el.style.transform = "scale(1.12)";
          el.style.boxShadow = "0 4px 18px rgba(0,0,0,.32)";
          el.style.opacity = "1";
          wrap.style.zIndex = "2";
        };
        wrap.onmouseleave = () => {
          el.style.transform = "scale(1)";
          el.style.boxShadow = "0 2px 10px rgba(0,0,0,.22)";
          el.style.opacity = "0.88";
          wrap.style.zIndex = "";
        };
        const flyTarget: [number, number] = ll;
        wrap.onclick = () => {
          setPicked({ kind: "district", row });
          // 點區泡泡 → 飛到該區，避免「在永康看到麻豆」式的視角錯位
          mapRef.current?.flyTo({ center: flyTarget, zoom: ROAD_ZOOM_THRESHOLD + 0.2, speed: 1.4 });
        };

        const marker = new maplibregl.Marker({ element: wrap, anchor: "center" })
          .setLngLat(ll)
          .addTo(m);
        markersRef.current.push(marker);
      });
    }
  }, [zoom, heatmap, roads, cc, districtStats, roadStats, picked, districtCenters]);

  const showRoads = zoom >= ROAD_ZOOM_THRESHOLD;
  const visibleRoads = roads.filter(r => r.lat != null && r.lng != null).length;
  const totalRoads = roads.length;
  const affordableDistricts = useMemo(() => {
    const budget = budgetWan * 10000;
    return heatmap
      .filter(r => r.median_unit_price_ping && r.deals)
      .map((r) => ({
        ...r,
        estimatedTotal: (r.median_unit_price_ping ?? 0) * areaPing,
        ratio: ((r.median_unit_price_ping ?? 0) * areaPing) / budget,
      }))
      .sort((a, b) => a.ratio - b.ratio);
  }, [heatmap, budgetWan, areaPing]);

  const focusDistrict = (row: HeatmapRow) => {
    setPicked({ kind: "district", row });
    const ll = districtCenters[row.district] ?? getCentroid(cc, row.district);
    if (ll) mapRef.current?.flyTo({ center: ll, zoom: ROAD_ZOOM_THRESHOLD + 0.2, speed: 1.4 });
  };

  return (
    <div className="space-y-3 lg:space-y-6">
      {/* 標題 — 桌面顯示完整介紹，手機只顯示精簡版 */}
      <section className="panel p-4 lg:p-8">
        <div className="label hidden lg:block">Map view</div>
        <h1 className="font-serif text-xl lg:text-3xl lg:mt-2 text-ink-900">地圖搜尋</h1>
        <p className="hidden lg:block mt-3 max-w-2xl text-ink-600 leading-7">
          縮放在 <strong>13 級以下</strong>顯示「鄉鎮泡泡」、<strong>13 級以上</strong>切換到「路段點」。
          泡泡上的數字 = 中位單價（萬/坪）。基於資料保護，我們不還原個別物件門牌。
        </p>
      </section>

      {/* 控制 + 圖例 */}
      <div className="panel p-3 lg:p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <select
            className="rounded-md border border-ink-200 bg-white px-3 py-1.5 text-sm"
            value={cc}
            onChange={(e) => setCc(e.target.value)}
          >
            {counties.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
          <DealKindTabs value={dk} onChange={setDk} />

          <div className="relative flex-1 min-w-[220px] max-w-[420px]">
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setSearchOpen(true); }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
              placeholder="輸入路名或地址（例：中華路、勝學路）"
              className="w-full rounded-md border border-ink-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus:border-accent"
            />
            {search && (
              <button
                onClick={() => { setSearch(""); setSearchOpen(false); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700 text-sm"
                title="清除"
              >✕</button>
            )}
            {searchOpen && searchResults.length > 0 && (
              <div className="absolute z-50 mt-1 w-full bg-white border border-ink-200 rounded-md shadow-lg max-h-[320px] overflow-y-auto">
                {searchResults.map((hit, idx) => {
                  if (hit.kind === "road") {
                    const r = hit.row;
                    const wan = r.median_unit_price_ping ? (r.median_unit_price_ping / 10000).toFixed(1) : "—";
                    return (
                      <button
                        key={`R-${r.road}-${idx}`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleSearchSelect(hit)}
                        className="w-full text-left px-3 py-2 hover:bg-ink-50 border-b border-ink-100 last:border-0 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-ink-900 truncate">
                            <span className="text-[10px] text-ink-400 mr-1.5">路段</span>
                            {r.road.replace(r.district, "")}
                          </div>
                          <div className="text-[10px] text-ink-500">{r.district} · {r.deals} 筆</div>
                        </div>
                        <div className="text-xs stat-num text-ink-700 shrink-0">{wan} 萬/坪</div>
                      </button>
                    );
                  }
                  // 個別交易
                  const d = hit.row;
                  const wan = d.unit_price_per_ping ? (d.unit_price_per_ping / 10000).toFixed(1) : "—";
                  const addr = (d.address ?? d.road ?? "").replace(d.district, "");
                  return (
                    <button
                      key={`D-${d.serial_no}-${idx}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleSearchSelect(hit)}
                      className="w-full text-left px-3 py-2 hover:bg-ink-50 border-b border-ink-100 last:border-0 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-ink-900 truncate">
                          <span className="text-[10px] text-accent mr-1.5">門牌</span>
                          {addr}
                        </div>
                        <div className="text-[10px] text-ink-500">
                          {d.district} · {d.deal_date}
                          {d.building_type ? ` · ${d.building_type.replace(/\(.*?\)/g, "")}` : ""}
                        </div>
                      </div>
                      <div className="text-xs stat-num text-ink-700 shrink-0">{wan} 萬/坪</div>
                    </button>
                  );
                })}
              </div>
            )}
            {searchOpen && search.trim() && searchResults.length === 0 && (
              <div className="absolute z-50 mt-1 w-full bg-white border border-ink-200 rounded-md shadow-lg px-3 py-3 text-xs text-ink-500">
                找不到符合的路段或門牌（試試「中華路」或「中華路100號」）
              </div>
            )}
          </div>

          <div className="ml-auto flex items-center gap-3 text-xs text-ink-500">
            <span className="pill">
              <span className="w-1.5 h-1.5 rounded-full bg-ink-900" />
              zoom <span className="stat-num text-ink-900">{zoom.toFixed(1)}</span>
              <span className="text-ink-400">·</span>
              {showRoads
                ? <span className="text-accent">路段層 ({visibleRoads}/{totalRoads})</span>
                : <span>鄉鎮層</span>}
            </span>
            <span>低</span>
            <span className="inline-block h-3 w-32 rounded-full"
                  style={{ background: "linear-gradient(90deg, #0e7490 0%, #d97706 50%, #b91c1c 100%)" }} />
            <span>高</span>
          </div>
        </div>

        {/* 底圖 + 政府疊圖（NLSC 全國圖磚） */}
        <div className="flex flex-wrap items-center gap-2 text-sm pt-2 border-t border-ink-100">
          <span className="text-xs text-ink-500 mr-1">底圖：</span>
          <div className="inline-flex items-center gap-0.5 rounded-lg border border-ink-200 bg-ink-100/60 p-0.5">
            {BASEMAPS.map((b) => (
              <button
                key={b.id}
                onClick={() => setBasemap(b.id)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                  basemap === b.id ? "bg-ink-900 text-ink-50 shadow-sm" : "text-ink-500 hover:text-brass-700"
                }`}
                title={b.attribution}
              >
                {b.icon} {b.label}
              </button>
            ))}
          </div>

          <span className="ml-2 text-xs text-ink-500 mr-1">疊圖：</span>
          {OVERLAYS.map((o) => (
            <button
              key={o.id}
              onClick={() => setOverlayOn(s => ({ ...s, [o.id]: !s[o.id] }))}
              title={o.desc}
              className={`btn !text-xs !py-1 !px-2.5 ${overlayOn[o.id] ? "btn-brass" : ""}`}
            >
              {o.label}
            </button>
          ))}
          {(overlayOn.luimap || overlayOn.landsect) && (
            <label className="ml-1 flex items-center gap-1.5 text-[11px] text-ink-500">
              透明度
              <input type="range" min={0.2} max={1} step={0.05} value={overlayOpacity}
                onChange={(e) => setOverlayOpacity(+e.target.value)} className="w-20" />
            </label>
          )}
          <span className="ml-auto text-[10px] text-ink-400">圖磚 © 內政部國土測繪中心</span>
        </div>

        {/* 圖層切換 */}
        <div className="flex flex-wrap items-center gap-2 text-sm pt-2 border-t border-ink-100">
          <span className="text-xs text-ink-500 mr-2">標點：</span>
          {(Object.keys(POI_STYLE) as PoiLayer[]).map((k) => (
            <button
              key={k}
              onClick={() => setPoiOn(s => ({ ...s, [k]: !s[k] }))}
              className={`btn !text-xs !py-1 !px-2.5 ${poiOn[k] ? "btn-active" : ""}`}
              style={poiOn[k] ? { background: POI_STYLE[k].color, borderColor: POI_STYLE[k].color } : undefined}
            >
              {POI_STYLE[k].icon} {POI_STYLE[k].label}
              {poiOn[k] && pois[k].length > 0 && (
                <span className="ml-1 opacity-80 stat-num">({pois[k].length})</span>
              )}
            </button>
          ))}
          <span className="text-[11px] text-ink-400 ml-auto">
            zoom ≥ 14 顯示文字標籤
          </span>
        </div>

        {/* 預算地圖 */}
        {dk === "sale" && (
          <div className="grid gap-3 border-t border-ink-100 pt-3 lg:grid-cols-[280px_1fr]">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <label className="text-sm text-ink-700">
                預算 <span className="stat-num text-ink-900">{fmt(budgetWan)}</span> 萬
                <input
                  type="range"
                  min={500}
                  max={6000}
                  step={50}
                  value={budgetWan}
                  onChange={(e) => setBudgetWan(+e.target.value)}
                  className="mt-2 w-full"
                />
              </label>
              <label className="text-sm text-ink-700">
                目標坪數 <span className="stat-num text-ink-900">{areaPing}</span> 坪
                <input
                  type="range"
                  min={12}
                  max={80}
                  step={1}
                  value={areaPing}
                  onChange={(e) => setAreaPing(+e.target.value)}
                  className="mt-2 w-full"
                />
              </label>
            </div>
            <div className="min-w-0">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <div className="label">預算地圖</div>
                  <div className="text-xs text-ink-500">用行政區中位單價粗估 {areaPing} 坪總價，綠色代表預算內。</div>
                </div>
                <a className="btn hidden md:inline-flex" href={`/dashboard`}>
                  進儀表板精算
                </a>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {affordableDistricts.slice(0, 12).map((r) => {
                  const inBudget = r.ratio <= 1;
                  return (
                    <button
                      key={r.district}
                      onClick={() => focusDistrict(r)}
                      className={`min-w-[150px] rounded-md border px-3 py-2 text-left transition ${
                        inBudget ? "border-up/30 bg-emerald-50" : "border-amber-300 bg-amber-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-ink-900">{r.district}</span>
                        <span className={`stat-num text-xs ${inBudget ? "text-up" : "text-amber-700"}`}>
                          {(r.ratio * 100).toFixed(0)}%
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-ink-600">
                        約 {fmtWan(r.estimatedTotal)} 萬 · {fmtPing(r.median_unit_price_ping)} 萬/坪
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 地圖 + 詳情 */}
      <div className="grid gap-3 lg:gap-4 lg:grid-cols-[1fr_320px]">
        <div className="panel overflow-hidden relative">
          <div ref={container} className="w-full h-[60vh] min-h-[420px] lg:h-[580px]" />
          {!showRoads && (
            <div className="absolute bottom-3 left-3 rounded-md bg-white/95 px-3 py-1.5 text-xs text-ink-700 shadow border border-ink-200 pointer-events-none">
              💡 滾輪放大或按 + 看路段資料（已索引 {visibleRoads} 條路段）
            </div>
          )}
          {showRoads && visibleRoads === 0 && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md bg-white/95 px-4 py-3 text-sm text-ink-700 shadow border border-ink-200 max-w-xs text-center">
              此縣市的路段尚未索引。<br/>
              <span className="text-xs text-ink-500 mt-1 block">
                到 pipeline/ 跑 <code className="bg-ink-100 px-1">python -m realprice geocode</code>
              </span>
            </div>
          )}
        </div>

        <div className={`panel p-4 lg:p-5 ${picked ? "" : "hidden lg:block"}`}>
          {picked?.kind === "district" && (() => {
            const districtRecent = recent
              .filter(r => r.district === picked.row.district)
              .slice(0, 8);
            const poiSummary = poiCountsNear(cc, picked.row.district, pois, 1.2);
            const areaReport = buildAreaNarrative({
              row: picked.row,
              countyMedian: districtStats.min && districtStats.max ? (districtStats.min + districtStats.max) / 2 : null,
              poi: poiSummary,
            });
            return (
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="label">{counties.find(c => c.code === cc)?.name}</div>
                    <h3 className="mt-1 font-serif text-2xl text-ink-900">{picked.row.district}</h3>
                  </div>
                  <button
                    onClick={() => {
                      setPicked(null);
                      const v = COUNTY_VIEW[cc] ?? COUNTY_VIEW.a;
                      mapRef.current?.flyTo({ center: v.center, zoom: v.zoom, speed: 1.4 });
                    }}
                    className="text-xs text-ink-500 hover:text-ink-900 px-2 py-1 rounded border border-ink-200"
                    title="回到全縣市"
                  >✕</button>
                </div>
                <dl className="mt-4 space-y-3 text-sm">
                  <KV k="近 12 月成交" v={`${fmt(picked.row.deals)} 筆`} />
                  <KV k="中位 萬/坪" v={fmtPing(picked.row.median_unit_price_ping)} highlight />
                  <KV k="均價 萬/坪" v={fmtPing(picked.row.avg_unit_price_ping)} />
                  <KV k="中位總價 (萬)" v={fmtWan(picked.row.median_total_price)} />
                </dl>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    className="btn"
                    disabled={isShortlisted(cc, picked.row.district)}
                    onClick={() => addShortlist({ county: cc, countyName, district: picked.row.district, source: "map" })}
                  >
                    {isShortlisted(cc, picked.row.district) ? "已在比較籃" : "加入比較籃"}
                  </button>
                  <a href="/compare" className="btn">前往比較</a>
                </div>
                <div className="mt-4 rounded-md border border-ink-200 bg-ink-50 p-3">
                  <div className="label mb-2">生活機能摘要</div>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="rounded bg-white px-2 py-2">
                      <div className="stat-num text-accent">{fmt(poiSummary.stations)}</div>
                      <div className="text-ink-500">車站</div>
                    </div>
                    <div className="rounded bg-white px-2 py-2">
                      <div className="stat-num text-up">{fmt(poiSummary.schools)}</div>
                      <div className="text-ink-500">學校</div>
                    </div>
                    <div className="rounded bg-white px-2 py-2">
                      <div className="stat-num text-down">{fmt(poiSummary.nimby)}</div>
                      <div className="text-ink-500">嫌惡</div>
                    </div>
                  </div>
                  <div className="mt-2 text-xs leading-5 text-ink-600">
                    {areaReport.notes.concat(areaReport.warnings).slice(0, 2).join(" ")}
                  </div>
                </div>

                {districtRecent.length > 0 && (
                  <div className="mt-5">
                    <div className="label mb-2">近期成交（點選跳到地圖）</div>
                    <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-1">
                      {districtRecent.map(r => {
                        const wan = r.unit_price_per_ping ? (r.unit_price_per_ping / 10000).toFixed(1) : "—";
                        const total = r.total_price ? (r.total_price / 10000).toFixed(0) : "—";
                        const addr = (r.address ?? r.road ?? picked.row.district).replace(picked.row.district, "");
                        // 優先用個別交易的 lat/lng（addr-geocode 後填入），沒有才退回路段
                        const rr = roads.find(x => x.road === r.road);
                        const flyLat = r.lat ?? rr?.lat ?? null;
                        const flyLng = r.lng ?? rr?.lng ?? null;
                        const canFly = flyLat != null && flyLng != null;
                        return (
                          <button
                            key={r.serial_no}
                            disabled={!canFly}
                            onClick={() => {
                              if (flyLat == null || flyLng == null) return;
                              if (rr) setPicked({ kind: "road", row: rr });
                              mapRef.current?.flyTo({ center: [flyLng, flyLat], zoom: 16.5, speed: 1.6 });
                            }}
                            className={`w-full text-xs flex justify-between items-center border-b border-dotted border-ink-200 pb-1.5 text-left transition-colors ${canFly ? "hover:bg-ink-50 cursor-pointer" : "opacity-60 cursor-default"}`}
                          >
                            <div className="min-w-0 flex-1 pr-2">
                              <div className="text-ink-700 truncate">{addr || picked.row.district}</div>
                              <div className="text-ink-400 text-[10px]">{r.deal_date} · {(r.building_type ?? "").replace(/\(.*?\)/g, "")}</div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="stat-num text-ink-900">{wan} 萬</div>
                              <div className="text-ink-400 text-[10px]">總 {total} 萬</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <a
                  href={`/region?county=${cc}&district=${encodeURIComponent(picked.row.district)}&dk=${dk}`}
                  className="mt-5 inline-block btn btn-active"
                >看月度趨勢 →</a>
              </div>
            );
          })()}
          {picked?.kind === "road" && (() => {
            const roadRow = picked.row;
            // 1) 同路段成交（最相關）；2) 800m 內路段成交（按距離排）
            type DealItem = { deal: RecentRow; distM: number; sameRoad: boolean; lat: number | null; lng: number | null };
            // 優先用個別交易的 lat/lng（addr-geocode 後填入），沒有才退回路段中心
            const dealCoord = (d: RecentRow, fallbackLat: number | null, fallbackLng: number | null) => ({
              lat: d.lat ?? fallbackLat,
              lng: d.lng ?? fallbackLng,
            });
            const sameRoad: DealItem[] = recent
              .filter(d => d.road === roadRow.road)
              .map(d => {
                const c = dealCoord(d, roadRow.lat, roadRow.lng);
                return { deal: d, distM: 0, sameRoad: true, lat: c.lat, lng: c.lng };
              });
            const nearbyByDist: DealItem[] = (recent
              .filter(d => d.road !== roadRow.road)
              .map(d => {
                const rr = roads.find(x => x.road === d.road);
                const fLat = rr?.lat ?? null;
                const fLng = rr?.lng ?? null;
                const c = dealCoord(d, fLat, fLng);
                if (c.lat == null || c.lng == null || roadRow.lat == null || roadRow.lng == null) return null;
                const dlat = c.lat - roadRow.lat;
                const dlng = c.lng - roadRow.lng;
                const distM = Math.sqrt(dlat * dlat + dlng * dlng) * 111000;
                if (distM > 800) return null;
                return { deal: d, distM, sameRoad: false, lat: c.lat, lng: c.lng } as DealItem;
              })
              .filter((x) => x !== null) as DealItem[])
              .sort((a, b) => a.distM - b.distM);
            const merged: DealItem[] = [...sameRoad, ...nearbyByDist].slice(0, 12);

            return (
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="label">{counties.find(c => c.code === cc)?.name} · {roadRow.district}</div>
                    <h3 className="mt-1 font-serif text-2xl text-ink-900">{roadRow.road.replace(roadRow.district, "")}</h3>
                  </div>
                  <button
                    onClick={() => setPicked(null)}
                    className="text-xs text-ink-500 hover:text-ink-900 px-2 py-1 rounded border border-ink-200"
                    title="關閉"
                  >✕</button>
                </div>
                <dl className="mt-4 space-y-3 text-sm">
                  <KV k="近 24 月成交" v={`${fmt(roadRow.deals)} 筆`} />
                  <KV k="中位 萬/坪" v={fmtPing(roadRow.median_unit_price_ping)} highlight />
                  <KV k="均價 萬/坪" v={fmtPing(roadRow.avg_unit_price_ping)} />
                  <KV k="中位總價 (萬)" v={fmtWan(roadRow.median_total_price)} />
                  <KV k="最後成交日" v={roadRow.last_deal_date ?? "—"} />
                </dl>
                {roadRow.lat != null && roadRow.lng != null && (
                  <a href={streetView(roadRow.lat, roadRow.lng)} target="_blank" rel="noopener noreferrer"
                     className="btn !text-xs mt-3 inline-flex">🛣 Google 街景看現場</a>
                )}

                {merged.length > 0 && (
                  <div className="mt-5">
                    <div className="label mb-2">最近的 {merged.length} 個案子（點選跳到地圖）</div>
                    <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
                      {merged.map(({ deal, distM, sameRoad: same, lat, lng }) => {
                        const wan = deal.unit_price_per_ping ? (deal.unit_price_per_ping / 10000).toFixed(1) : "—";
                        const total = deal.total_price ? (deal.total_price / 10000).toFixed(0) : "—";
                        const addr = (deal.address ?? deal.road ?? "").replace(roadRow.district, "");
                        const distLabel = same ? "同路段" : `${Math.round(distM)}m`;
                        const canFly = lat != null && lng != null;
                        return (
                          <button
                            key={deal.serial_no}
                            disabled={!canFly}
                            onClick={() => {
                              if (lat == null || lng == null) return;
                              mapRef.current?.flyTo({ center: [lng, lat], zoom: 16.5, speed: 1.6 });
                            }}
                            className={`w-full text-xs flex justify-between items-center border-b border-dotted border-ink-200 pb-1.5 text-left transition-colors ${canFly ? "hover:bg-ink-50 cursor-pointer" : "opacity-60 cursor-default"}`}
                          >
                            <div className="min-w-0 flex-1 pr-2">
                              <div className="text-ink-700 truncate">{addr || roadRow.district}</div>
                              <div className="text-ink-400 text-[10px]">
                                <span className={same ? "text-accent" : ""}>{distLabel}</span>
                                {" · "}{deal.deal_date}
                                {" · "}{(deal.building_type ?? "").replace(/\(.*?\)/g, "")}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="stat-num text-ink-900">{wan} 萬</div>
                              <div className="text-ink-400 text-[10px]">總 {total} 萬</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
          {picked?.kind === "poi" && (() => {
            const style = POI_STYLE[picked.layer];
            // 計算這個 POI 800m 內路段的中位單價
            const R = 0.008; // ~800m 在 lat/lng 上
            const nearbyRoads = roads.filter(r =>
              r.lat != null && r.lng != null &&
              Math.abs(r.lat - picked.row.lat) < R &&
              Math.abs(r.lng - picked.row.lng) < R
            );
            const prices = nearbyRoads.map(r => r.median_unit_price_ping ?? 0).filter(Boolean);
            const med = prices.length ? prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)] : null;
            return (
              <div>
                <div className="label" style={{ color: style.color }}>{style.label} · {picked.row.subtype}</div>
                <h3 className="mt-1 font-serif text-2xl text-ink-900">{style.icon} {picked.row.name}</h3>
                <dl className="mt-4 space-y-3 text-sm">
                  <KV k="座標" v={`${picked.row.lat.toFixed(4)}, ${picked.row.lng.toFixed(4)}`} />
                  <KV k="800m 內路段數" v={`${nearbyRoads.length} 條`} />
                  <KV
                    k="800m 內中位價"
                    v={med ? `${(med / 10000).toFixed(1)} 萬/坪` : "—"}
                    highlight={!!med}
                  />
                </dl>
                <a href={streetView(picked.row.lat, picked.row.lng)} target="_blank" rel="noopener noreferrer"
                   className="btn !text-xs mt-3 inline-flex">🛣 Google 街景看現場</a>
                {nearbyRoads.length > 0 && (
                  <div className="mt-4">
                    <div className="label mb-2">附近路段</div>
                    <div className="space-y-1 max-h-[180px] overflow-y-auto">
                      {nearbyRoads.slice(0, 8).map(r => (
                        <div key={r.road} className="text-xs flex justify-between border-b border-dotted border-ink-200 pb-1">
                          <span className="text-ink-700 truncate">{r.road.replace(r.district, "")}</span>
                          <span className="stat-num text-ink-900">
                            {r.median_unit_price_ping ? (r.median_unit_price_ping / 10000).toFixed(1) : "—"} 萬
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
          {!picked && (
            <div className="flex h-full flex-col justify-center text-sm text-ink-500">
              <div className="text-ink-400 text-center py-8">
                <div className="text-4xl mb-3">🗺</div>
                點地圖泡泡看詳情
                <div className="mt-3 text-xs">{showRoads ? "路段層 — 顯示已索引的路段" : "鄉鎮層 — 放大看路段"}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function streetView(lat: number, lng: number): string {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
}

function KV({ k, v, highlight = false }: { k: string; v: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between border-b border-dotted border-ink-200 pb-2">
      <dt className="text-ink-500">{k}</dt>
      <dd className={`stat-num ${highlight ? "text-accent text-lg" : "text-ink-900"}`}>{v}</dd>
    </div>
  );
}

function priceRange(prices: (number | null)[]): { min: number; max: number } {
  const xs = prices.filter((p): p is number => p != null && p > 0);
  return { min: Math.min(...xs, 1), max: Math.max(...xs, 1) };
}

function colorFor(price: number | null, stats: { min: number; max: number }): string {
  if (!price) return "#a99e86";
  const t = (price - stats.min) / Math.max(1, stats.max - stats.min);
  if (t < 0.5) return interpolate("#0e7490", "#d97706", t / 0.5);
  return interpolate("#d97706", "#b91c1c", (t - 0.5) / 0.5);
}

function interpolate(c1: string, c2: string, t: number): string {
  const h2r = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const [r1, g1, b1] = h2r(c1);
  const [r2, g2, b2] = h2r(c2);
  const r = Math.round(r1 + (r2 - r1) * Math.max(0, Math.min(1, t)));
  const g = Math.round(g1 + (g2 - g1) * Math.max(0, Math.min(1, t)));
  const b = Math.round(b1 + (b2 - b1) * Math.max(0, Math.min(1, t)));
  return `rgb(${r},${g},${b})`;
}
