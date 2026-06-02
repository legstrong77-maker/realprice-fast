import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import { lazy, Suspense, useEffect, useState } from "react";
import { data, type Meta } from "./lib/data";
import WorkflowSteps from "./components/WorkflowSteps";

const HomePage = lazy(() => import("./pages/HomePage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const MapPage = lazy(() => import("./pages/MapPage"));
const RegionPage = lazy(() => import("./pages/RegionPage"));
const EstimatePage = lazy(() => import("./pages/EstimatePage"));
const UnderpricedPage = lazy(() => import("./pages/UnderpricedPage"));
const ComparePage = lazy(() => import("./pages/ComparePage"));
const ReportPage = lazy(() => import("./pages/ReportPage"));
const BrowsePage = lazy(() => import("./pages/BrowsePage"));
const CalcPage = lazy(() => import("./pages/CalcPage"));
const YieldPage = lazy(() => import("./pages/YieldPage"));
const SellPage = lazy(() => import("./pages/SellPage"));
const CostPage = lazy(() => import("./pages/CostPage"));
const CommunityPage = lazy(() => import("./pages/CommunityPage"));
const AboutPage = lazy(() => import("./pages/AboutPage"));

const NAV: { to: string; label: string }[] = [
  { to: "/", label: "首頁總覽" },
  { to: "/dashboard", label: "買房儀表板" },
  { to: "/map", label: "地圖搜尋" },
  { to: "/region", label: "縣市深掘" },
  { to: "/estimate", label: "估價工具" },
  { to: "/sell", label: "賣房估價" },
  { to: "/community", label: "社區同棟" },
  { to: "/underpriced", label: "撿漏雷達" },
  { to: "/yield", label: "租金投報" },
  { to: "/compare", label: "多區比較" },
  { to: "/report", label: "買房報告" },
  { to: "/browse", label: "成交瀏覽" },
  { to: "/calc", label: "購屋試算" },
  { to: "/cost", label: "交易成本" },
  { to: "/about", label: "關於與方法" },
];

function daysSince(dateText: string | null | undefined) {
  if (!dateText) return null;
  const dt = new Date(`${dateText.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.floor((today.getTime() - dt.getTime()) / 86_400_000));
}

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const loc = useLocation();

  useEffect(() => {
    data.meta().then(setMeta).catch((e) => setErr(String(e)));
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // 換頁時捲回頂端
  useEffect(() => { window.scrollTo({ top: 0, behavior: "auto" }); }, [loc.pathname]);

  const lastSale = meta?.last_deal_date?.sale ?? "—";
  const staleDays = daysSince(meta?.last_deal_date?.sale);
  const freshnessTone =
    staleDays == null ? "text-ink-500"
    : staleDays > 21 ? "text-down"
    : staleDays > 14 ? "text-brass-600"
    : "text-up";

  return (
    <div className="relative z-10 flex min-h-screen flex-col">
      {/* —— 報頭 —— */}
      <header
        className={`sticky top-0 z-30 border-b transition-all duration-300 ${
          scrolled
            ? "border-ink-200/70 bg-[#f8f4ec]/85 backdrop-blur-md shadow-[0_1px_0_rgba(28,24,19,0.04)]"
            : "border-transparent bg-transparent"
        }`}
      >
        <div className="mx-auto flex max-w-[1320px] items-end justify-between gap-3 px-4 pb-2.5 pt-3 lg:px-8 lg:pt-5">
          <NavLink to="/" className="group block min-w-0">
            <div className="hidden text-[10px] font-semibold uppercase tracking-[0.32em] text-brass-600 lg:block">
              Real-Price Quarterly · 買房決策誌
            </div>
            <div className="display text-[28px] leading-none text-ink-900 lg:text-[34px]">
              Realprice<span className="text-brass-500">.</span>
            </div>
          </NavLink>
          <div className="shrink-0 text-right text-[11px] text-ink-500 lg:text-xs">
            <div>
              最新成交{" "}
              <span className="stat-num text-ink-900">{lastSale}</span>
            </div>
            <div className={`hidden lg:block ${freshnessTone}`}>
              {staleDays == null
                ? "資料來源 · 內政部實價登錄 Open Data"
                : `距今 ${staleDays} 天 · ${staleDays > 14 ? "建議更新" : "資料新鮮"}`}
            </div>
          </div>
        </div>

        {/* 主導覽 */}
        <nav className="mx-auto max-w-[1320px] overflow-x-auto px-4 pb-0 lg:px-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex items-center gap-0.5 whitespace-nowrap">
            {NAV.map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                end={it.to === "/"}
                className={({ isActive }) =>
                  `relative shrink-0 px-3 py-2.5 text-[13px] transition-colors duration-200
                  ${isActive
                    ? "font-semibold text-ink-900"
                    : "text-ink-500 hover:text-brass-700"}
                  after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:origin-left after:rounded-full
                  after:bg-brass-500 after:transition-transform after:duration-300
                  ${isActive ? "after:scale-x-100" : "after:scale-x-0"}`
                }
              >
                {it.label}
              </NavLink>
            ))}
            <div className="ml-auto hidden shrink-0 pl-4 text-[10px] uppercase tracking-[0.2em] text-ink-400 lg:block">
              v0.3 · 全台版
            </div>
          </div>
        </nav>
      </header>

      {/* —— 內容 —— */}
      <main className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-8 lg:px-8 lg:py-10">
        {err && (
          <div className="mb-6 rounded-lg border border-down/30 bg-red-50/60 px-4 py-3 text-sm text-down">
            載入 meta 失敗：{err}
            <span className="ml-2 text-ink-500">— 請確認已執行過 pipeline，並把 snapshots 同步到 web/public/data/</span>
          </div>
        )}
        {meta && staleDays != null && staleDays > 14 && (
          <div className="mb-6 rounded-lg border border-brass-300 bg-brass-50 px-4 py-3 text-sm text-brass-800">
            目前買賣資料最新到 <span className="stat-num">{lastSale}</span>，距今 {staleDays} 天。若要做最新決策，建議先跑一次資料更新。
          </div>
        )}
        <WorkflowSteps pathname={loc.pathname} />
        <Suspense fallback={<PageFallback />}>
          <div key={loc.pathname} className="animate-fade-in">
            <Routes>
              <Route path="/" element={<HomePage meta={meta} />} />
              <Route path="/dashboard" element={<DashboardPage meta={meta} />} />
              <Route path="/map" element={<MapPage meta={meta} />} />
              <Route path="/region" element={<RegionPage meta={meta} />} />
              <Route path="/estimate" element={<EstimatePage meta={meta} />} />
              <Route path="/underpriced" element={<UnderpricedPage meta={meta} />} />
              <Route path="/compare" element={<ComparePage meta={meta} />} />
              <Route path="/report" element={<ReportPage meta={meta} />} />
              <Route path="/browse" element={<BrowsePage meta={meta} />} />
              <Route path="/calc" element={<CalcPage />} />
              <Route path="/yield" element={<YieldPage meta={meta} />} />
              <Route path="/sell" element={<SellPage meta={meta} />} />
              <Route path="/cost" element={<CostPage />} />
              <Route path="/community" element={<CommunityPage meta={meta} />} />
              <Route path="/about" element={<AboutPage />} />
            </Routes>
          </div>
        </Suspense>
      </main>

      {/* —— 頁尾 —— */}
      <footer className="mt-8 border-t border-ink-200/70 bg-[#fdfbf6]/60">
        <div className="mx-auto max-w-[1320px] px-4 py-8 lg:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-md">
              <div className="display text-2xl text-ink-900">
                Realprice<span className="text-brass-500">.</span>
              </div>
              <p className="mt-2 text-xs leading-6 text-ink-500">
                全台 22 縣市實價登錄，做成買房決策工具。所有統計僅供參考，
                不構成投資、不動產或金融建議。資料著作權屬內政部。
              </p>
            </div>
            <div className="text-xs text-ink-500">
              <div className="kicker mb-2 text-brass-600">Colophon</div>
              <div>資料 · 內政部實價登錄 Open Data</div>
              {meta && <div className="stat-num mt-0.5">更新 {meta.generated_at?.slice(0, 10)}</div>}
              <div className="mt-0.5">預烘靜態 JSON · CDN 邊緣直送</div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function PageFallback() {
  return (
    <div className="space-y-4">
      <div className="skeleton h-44 w-full" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-24" />)}
      </div>
      <div className="skeleton h-72 w-full" />
    </div>
  );
}
