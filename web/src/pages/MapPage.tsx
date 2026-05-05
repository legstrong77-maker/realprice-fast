import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  data, type DealKind, type HeatmapRow, type Meta, type RoadRow, type POI,
} from "../lib/data";
import { fmt, fmtPing, fmtWan } from "../lib/format";
import { getCentroid } from "../lib/districtCentroids";
import DealKindTabs from "../components/DealKindTabs";

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

const POI_STYLE: Record<PoiLayer, {
  label: string;
  color: string;
  icon: string;
  source: string;
}> = {
  stations: { label: "車站", color: "#1d4ed8", icon: "🚇", source: "stations" },
  schools:  { label: "學校", color: "#047857", icon: "🎓", source: "schools" },
  nimby:    { label: "嫌惡設施", color: "#b91c1c", icon: "⚠", source: "nimby" },
};

export default function MapPage({ meta }: { meta: Meta | null }) {
  const [cc, setCc] = useState("a");
  const [dk, setDk] = useState<DealKind>("sale");
  const [heatmap, setHeatmap] = useState<HeatmapRow[]>([]);
  const [roads, setRoads] = useState<RoadRow[]>([]);
  const [picked, setPicked] = useState<Picked>(null);
  const [zoom, setZoom] = useState(COUNTY_VIEW.a.zoom);

  // POI 圖層
  const [pois, setPois] = useState<Record<PoiLayer, POI[]>>({
    stations: [], schools: [], nimby: [],
  });
  const [poiOn, setPoiOn] = useState<Record<PoiLayer, boolean>>({
    stations: false, schools: false, nimby: false,
  });

  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const poiLayerInitRef = useRef(false);

  const counties = meta?.counties ?? [];

  // 抓 heatmap + roads
  useEffect(() => {
    setPicked(null);
    data.heatmap(cc, dk).then(setHeatmap).catch(() => setHeatmap([]));
    data.roads(cc, dk).then(setRoads).catch(() => setRoads([]));
  }, [cc, dk]);

  // 抓 POI（懶載入：toggle 開了才抓）
  useEffect(() => {
    (Object.keys(poiOn) as PoiLayer[]).forEach((k) => {
      if (poiOn[k] && pois[k].length === 0) {
        data.pois(k).then((rows) => setPois((p) => ({ ...p, [k]: rows }))).catch(() => {});
      }
    });
  }, [poiOn]);

  // 初始化地圖
  useEffect(() => {
    if (!container.current || mapRef.current) return;
    const view = COUNTY_VIEW.a;
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
    // 等 style 載完再加 POI source/layer
    map.on("load", () => {
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

  // 切縣市時飛過去
  useEffect(() => {
    const m = mapRef.current; if (!m) return;
    const v = COUNTY_VIEW[cc] ?? COUNTY_VIEW.a;
    m.flyTo({ center: v.center, zoom: v.zoom, speed: 1.4 });
  }, [cc]);

  // 顏色映射 (低=cyan700, 中=amber600, 高=red700)
  const districtStats = useMemo(() => priceRange(heatmap.map(h => h.median_unit_price_ping)), [heatmap]);
  const roadStats = useMemo(() => priceRange(roads.map(r => r.median_unit_price_ping)), [roads]);

  // 切換 zoom + 重畫 markers
  useEffect(() => {
    const m = mapRef.current; if (!m) return;
    markersRef.current.forEach(mk => mk.remove());
    markersRef.current = [];

    const showRoads = zoom >= ROAD_ZOOM_THRESHOLD;
    if (showRoads) {
      // 路段層
      const visible = roads.filter(r => r.lat != null && r.lng != null);
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
          background:#1c1917;color:#fff;padding:6px 10px;border-radius:6px;
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
        const ll = getCentroid(cc, row.district);
        if (!ll) return;
        const dealMax = Math.max(...heatmap.map(h => h.deals ?? 0), 1);
        const t = (row.deals ?? 0) / dealMax;
        const size = Math.max(56, Math.round(40 + Math.sqrt(t) * 50));
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
        wrap.onclick = () => setPicked({ kind: "district", row });

        const marker = new maplibregl.Marker({ element: wrap, anchor: "center" })
          .setLngLat(ll)
          .addTo(m);
        markersRef.current.push(marker);
      });
    }
  }, [zoom, heatmap, roads, cc, districtStats, roadStats]);

  const showRoads = zoom >= ROAD_ZOOM_THRESHOLD;
  const visibleRoads = roads.filter(r => r.lat != null && r.lng != null).length;
  const totalRoads = roads.length;

  return (
    <div className="space-y-6">
      <section className="panel p-8">
        <div className="label">Map view</div>
        <h1 className="mt-2 font-serif text-3xl text-ink-900">地圖搜尋</h1>
        <p className="mt-3 max-w-2xl text-ink-600 leading-7">
          縮放在 <strong>13 級以下</strong>顯示「鄉鎮泡泡」、<strong>13 級以上</strong>切換到「路段點」。
          泡泡上的數字 = 中位單價（萬/坪）。基於資料保護，我們不還原個別物件門牌。
        </p>
      </section>

      {/* 控制 + 圖例 */}
      <div className="panel p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <select
            className="rounded-md border border-ink-200 bg-white px-3 py-1.5 text-sm"
            value={cc}
            onChange={(e) => setCc(e.target.value)}
          >
            {counties.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
          <DealKindTabs value={dk} onChange={setDk} />

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

        {/* 圖層切換 */}
        <div className="flex flex-wrap items-center gap-2 text-sm pt-2 border-t border-ink-100">
          <span className="text-xs text-ink-500 mr-2">圖層：</span>
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
      </div>

      {/* 地圖 + 詳情 */}
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="panel overflow-hidden relative">
          <div ref={container} style={{ width: "100%", height: 580 }} />
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

        <div className="panel p-5">
          {picked?.kind === "district" && (
            <div>
              <div className="label">{counties.find(c => c.code === cc)?.name}</div>
              <h3 className="mt-1 font-serif text-2xl text-ink-900">{picked.row.district}</h3>
              <dl className="mt-4 space-y-3 text-sm">
                <KV k="近 12 月成交" v={`${fmt(picked.row.deals)} 筆`} />
                <KV k="中位 萬/坪" v={fmtPing(picked.row.median_unit_price_ping)} highlight />
                <KV k="均價 萬/坪" v={fmtPing(picked.row.avg_unit_price_ping)} />
                <KV k="中位總價 (萬)" v={fmtWan(picked.row.median_total_price)} />
              </dl>
              <a
                href={`/region?county=${cc}&district=${encodeURIComponent(picked.row.district)}&dk=${dk}`}
                className="mt-5 inline-block btn btn-active"
              >看月度趨勢 →</a>
            </div>
          )}
          {picked?.kind === "road" && (
            <div>
              <div className="label">{counties.find(c => c.code === cc)?.name} · {picked.row.district}</div>
              <h3 className="mt-1 font-serif text-2xl text-ink-900">{picked.row.road.replace(picked.row.district, "")}</h3>
              <dl className="mt-4 space-y-3 text-sm">
                <KV k="近 24 月成交" v={`${fmt(picked.row.deals)} 筆`} />
                <KV k="中位 萬/坪" v={fmtPing(picked.row.median_unit_price_ping)} highlight />
                <KV k="均價 萬/坪" v={fmtPing(picked.row.avg_unit_price_ping)} />
                <KV k="中位總價 (萬)" v={fmtWan(picked.row.median_total_price)} />
                <KV k="最後成交日" v={picked.row.last_deal_date ?? "—"} />
              </dl>
            </div>
          )}
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
  if (!price) return "#a8a29e";
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
