import { useEffect, useMemo, useState } from "react";
import { data, type Meta, type RecentRow } from "../lib/data";
import { fmt, fmtPing, fmtWan, fmtDate } from "../lib/format";
import Section from "../components/Section";
import { Kpi, KpiBar } from "../components/KpiBar";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

/** 把門牌正規化到「棟」層級：截到「號」為止，去掉樓/之/室。 */
function buildingKey(addr: string | null): string | null {
  if (!addr) return null;
  const i = addr.indexOf("號");
  if (i < 0) return null;
  return addr.slice(0, i + 1);
}

interface Building {
  key: string;
  district: string;
  road: string | null;
  deals: RecentRow[];
  medianUnit: number | null;
  medianAge: number | null;
  maxFloors: number | null;
  lastDate: string;
}

function median(xs: number[]): number | null {
  const s = xs.filter(x => x != null && !isNaN(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export default function CommunityPage({ meta }: { meta: Meta | null }) {
  const counties = meta?.counties ?? [];
  const [cc, setCc] = useState("a");
  const [district, setDistrict] = useState("");
  const [kw, setKw] = useState("");
  const [recent, setRecent] = useState<RecentRow[]>([]);
  const [openKey, setOpenKey] = useState<string | null>(null);

  useEffect(() => {
    data.recent(cc, "sale").then(setRecent).catch(() => setRecent([]));
    setDistrict("");
    setOpenKey(null);
  }, [cc]);

  const districts = useMemo(
    () => Array.from(new Set(recent.map(r => r.district))).sort(),
    [recent]
  );

  // 依門牌號聚成「棟」
  const buildings = useMemo<Building[]>(() => {
    const map = new Map<string, RecentRow[]>();
    for (const r of recent) {
      if (r.is_special_deal) continue;
      const k = buildingKey(r.address);
      if (!k) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    const out: Building[] = [];
    for (const [key, deals] of map) {
      if (deals.length < 3) continue;     // 至少 3 筆才能看出棟內差異
      deals.sort((a, b) => (b.deal_date < a.deal_date ? -1 : 1));
      out.push({
        key,
        district: deals[0].district,
        road: deals[0].road,
        deals,
        medianUnit: median(deals.map(d => d.unit_price_per_ping!).filter(Boolean)),
        medianAge: median(deals.map(d => d.age_years!).filter(v => v != null)),
        maxFloors: Math.max(...deals.map(d => d.total_floors ?? 0)) || null,
        lastDate: deals[0].deal_date,
      });
    }
    return out.sort((a, b) => b.deals.length - a.deals.length);
  }, [recent]);

  const filtered = useMemo(() => {
    const q = kw.trim();
    return buildings.filter(b =>
      (!district || b.district === district) &&
      (!q || b.key.includes(q) || (b.road?.includes(q) ?? false))
    );
  }, [buildings, district, kw]);

  const shown = filtered.slice(0, 60);

  return (
    <div className="space-y-6">
      <section className="panel p-8">
        <div className="label">Building Lens · 社區同棟</div>
        <h1 className="mt-2 font-serif text-3xl text-ink-900">同一棟，到底成交多少？</h1>
        <p className="mt-3 max-w-2xl text-ink-600 leading-7">
          鄉鎮、路段行情看完，買賣決策最後一哩其實是<strong>「這一棟」</strong>。
          這裡把同一門牌的成交聚在一起，看<strong>同棟近期成交、樓層溢價、屋齡</strong>，
          幫你判斷某戶開價在自己這棟裡算貴還是便宜。
          <span className="text-ink-500">（依最新 2000 筆成交、同門牌號聚合，至少 3 筆才列出。基於資料保護不還原完整門牌與戶別。）</span>
        </p>
      </section>

      <Section
        kicker="找一棟"
        title="搜尋社區 / 大樓"
        right={
          <select className="input" value={cc} onChange={e => setCc(e.target.value)}>
            {counties.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        }
      >
        <div className="grid gap-3 md:grid-cols-[1fr_2fr]">
          <select className="input" value={district} onChange={e => setDistrict(e.target.value)}>
            <option value="">全部鄉鎮</option>
            {districts.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <input className="input" placeholder="路名或門牌關鍵字，如「文心路」「市政北二路」"
            value={kw} onChange={e => setKw(e.target.value)} />
        </div>
        <p className="mt-3 text-xs text-ink-500">
          共 {fmt(buildings.length)} 棟可分析，符合條件 {fmt(filtered.length)} 棟{filtered.length > 60 ? "（顯示前 60）" : ""}。
        </p>
      </Section>

      <div className="space-y-3">
        {shown.map(b => (
          <BuildingCard key={b.key} b={b} open={openKey === b.key}
            onToggle={() => setOpenKey(openKey === b.key ? null : b.key)} />
        ))}
        {shown.length === 0 && (
          <div className="panel p-8 text-center text-sm text-ink-400">
            找不到符合條件的社區 —— 換個鄉鎮或清空關鍵字試試。
          </div>
        )}
      </div>
    </div>
  );
}

function BuildingCard({ b, open, onToggle }: { b: Building; open: boolean; onToggle: () => void }) {
  // 樓層溢價：高樓層（上 1/3）vs 低樓層（下 1/3）單價中位
  const floorAnalysis = useMemo(() => {
    const withFloor = b.deals.filter(d => d.transfer_floor_num != null && d.unit_price_per_ping);
    if (withFloor.length < 4 || !b.maxFloors) return null;
    const hiCut = b.maxFloors * 2 / 3;
    const loCut = b.maxFloors / 3;
    const hi = median(withFloor.filter(d => d.transfer_floor_num! >= hiCut).map(d => d.unit_price_per_ping!));
    const lo = median(withFloor.filter(d => d.transfer_floor_num! <= loCut).map(d => d.unit_price_per_ping!));
    if (!hi || !lo) return null;
    return { hi, lo, premium: (hi - lo) / lo };
  }, [b]);

  const trend = useMemo(() => {
    const byMonth = new Map<string, number[]>();
    for (const d of b.deals) {
      if (!d.unit_price_per_ping) continue;
      const m = d.deal_date.slice(0, 7);
      if (!byMonth.has(m)) byMonth.set(m, []);
      byMonth.get(m)!.push(d.unit_price_per_ping);
    }
    return Array.from(byMonth.entries())
      .map(([m, xs]) => ({ month: m, 單價: Math.round((median(xs) ?? 0) / 10000 * 10) / 10 }))
      .sort((a, b) => (a.month < b.month ? -1 : 1));
  }, [b]);

  return (
    <div className="panel overflow-hidden">
      <button onClick={onToggle} className="w-full text-left px-5 py-4 hover:bg-ink-50 transition">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="font-medium text-ink-900 truncate">{b.key}</div>
            <div className="text-xs text-ink-500 mt-0.5">
              {b.district} · {b.deals.length} 筆成交 · 最新 {fmtDate(b.lastDate)}
              {b.maxFloors ? ` · 約 ${b.maxFloors} 層` : ""}
            </div>
          </div>
          <div className="flex items-center gap-5 shrink-0">
            <div className="text-right">
              <div className="stat-num text-lg text-ink-900">{fmtPing(b.medianUnit)}</div>
              <div className="text-[11px] text-ink-400">中位 萬/坪</div>
            </div>
            <span className="text-ink-400 text-sm">{open ? "▲" : "▼"}</span>
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-ink-200 p-5 space-y-5">
          <KpiBar>
            <Kpi label="同棟成交" value={fmt(b.deals.length)} sub="最新 2000 筆內" />
            <Kpi label="中位單價" value={`${fmtPing(b.medianUnit)}`} sub="萬/坪" />
            <Kpi label="屋齡中位" value={b.medianAge != null ? `${b.medianAge.toFixed(1)}` : "—"} sub="年" />
            <Kpi label="高/低樓溢價"
                 value={floorAnalysis ? `${floorAnalysis.premium > 0 ? "+" : ""}${(floorAnalysis.premium * 100).toFixed(0)}%` : "—"}
                 sub={floorAnalysis ? "高樓層 vs 低樓層" : "樣本不足"}
                 accent={floorAnalysis ? (floorAnalysis.premium >= 0 ? "up" : "down") : undefined} />
          </KpiBar>

          {floorAnalysis && (
            <div className="rounded-md border border-ink-200 bg-ink-50 p-3 text-sm text-ink-700">
              這棟高樓層（上 1/3）中位 <span className="stat-num">{fmtPing(floorAnalysis.hi)}</span> 萬/坪、
              低樓層（下 1/3）中位 <span className="stat-num">{fmtPing(floorAnalysis.lo)}</span> 萬/坪，
              高樓層溢價約 <strong>{(floorAnalysis.premium * 100).toFixed(0)}%</strong>。
              談價時可用「我看的是低樓層」爭取折讓，或反過來解釋高樓層為何開高。
            </div>
          )}

          {trend.length >= 2 && (
            <div className="h-[200px]">
              <ResponsiveContainer>
                <LineChart data={trend} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#e3dac8" vertical={false} />
                  <XAxis dataKey="month" stroke="#a99e86" tick={{ fontSize: 11 }} />
                  <YAxis stroke="#a99e86" tickFormatter={(v) => `${v}`} tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: "#1c1813", border: "none", color: "#f8f4ec", fontSize: 12, borderRadius: 6 }}
                    formatter={(v: any) => [`${v} 萬/坪`, "同棟中位"]}
                  />
                  <Line type="monotone" dataKey="單價" stroke="#b8862c" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="table-clean w-full">
              <thead>
                <tr>
                  <th>成交日</th>
                  <th className="text-right">樓層</th>
                  <th className="text-right">坪數</th>
                  <th>格局</th>
                  <th className="text-right">單價（萬/坪）</th>
                  <th className="text-right">總價（萬）</th>
                  <th className="text-right">屋齡</th>
                </tr>
              </thead>
              <tbody>
                {b.deals.map((d, i) => {
                  const ping = d.building_area_sqm ? d.building_area_sqm / 3.305785 : null;
                  return (
                    <tr key={d.serial_no + i}>
                      <td className="stat-num text-ink-500">{fmtDate(d.deal_date)}</td>
                      <td className="text-right stat-num">
                        {d.transfer_floor_num != null ? `${d.transfer_floor_num}` : "—"}
                        {d.total_floors ? <span className="text-ink-400">/{d.total_floors}</span> : ""}
                      </td>
                      <td className="text-right stat-num">{ping ? ping.toFixed(1) : "—"}</td>
                      <td className="text-ink-600 text-xs">
                        {d.rooms != null ? `${d.rooms}房${d.halls ?? 0}廳${d.baths ?? 0}衛` : "—"}
                      </td>
                      <td className="text-right stat-num">{fmtPing(d.unit_price_per_ping)}</td>
                      <td className="text-right stat-num">{fmtWan(d.total_price, 0)}</td>
                      <td className="text-right stat-num text-ink-500">{d.age_years != null ? d.age_years.toFixed(0) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
