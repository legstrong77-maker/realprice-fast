import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import HomePage from "./pages/HomePage";
import RegionPage from "./pages/RegionPage";
import MapPage from "./pages/MapPage";
import BrowsePage from "./pages/BrowsePage";
import ComparePage from "./pages/ComparePage";
import EstimatePage from "./pages/EstimatePage";
import UnderpricedPage from "./pages/UnderpricedPage";
import CalcPage from "./pages/CalcPage";
import AboutPage from "./pages/AboutPage";
import { data, type Meta } from "./lib/data";

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const loc = useLocation();

  useEffect(() => {
    data.meta()
      .then(setMeta)
      .catch((e) => setErr(String(e)));
  }, []);

  const lastSale = meta?.last_deal_date?.sale ?? "—";

  return (
    <div className="min-h-screen flex flex-col">
      {/* —— 頂部：報頭 —— */}
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-[1300px] items-end justify-between px-6 pt-5 pb-3">
          <div>
            <NavLink to="/" className="block">
              <div className="text-[11px] uppercase tracking-[0.25em] text-ink-500">
                Real-Price Quarterly · 全台 22 縣市
              </div>
              <div className="font-serif text-3xl tracking-tightish text-ink-900">
                Realprice<span className="text-accent">.</span>
              </div>
            </NavLink>
          </div>
          <div className="text-right text-xs text-ink-500">
            <div>最新成交日 <span className="stat-num text-ink-900">{lastSale}</span></div>
            <div>資料來源 · 內政部實價登錄 Open Data</div>
          </div>
        </div>

        {/* —— 主導覽 —— */}
        <nav className="mx-auto flex max-w-[1300px] items-center gap-1 px-6 pb-2">
          {[
            { to: "/", label: "首頁總覽" },
            { to: "/map", label: "地圖搜尋" },
            { to: "/region", label: "縣市深掘" },
            { to: "/estimate", label: "估價工具" },
            { to: "/underpriced", label: "撿漏雷達" },
            { to: "/compare", label: "多區比較" },
            { to: "/browse", label: "成交瀏覽" },
            { to: "/calc", label: "購屋試算" },
            { to: "/about", label: "關於與方法" },
          ].map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.to === "/"}
              className={({ isActive }) =>
                `px-3 py-1.5 text-sm border-b-2 transition -mb-px
                ${isActive
                  ? "border-ink-900 text-ink-900 font-medium"
                  : "border-transparent text-ink-500 hover:text-ink-900"}`
              }
            >
              {it.label}
            </NavLink>
          ))}
          <div className="ml-auto text-[11px] uppercase tracking-[0.15em] text-ink-400">
            v0.2 · 全台版
          </div>
        </nav>
      </header>

      {/* —— 內容 —— */}
      <main className="mx-auto w-full max-w-[1300px] flex-1 px-6 py-8">
        {err && (
          <div className="mb-6 rounded border border-down/30 bg-red-50 px-4 py-3 text-sm text-down">
            載入 meta 失敗：{err}
            <span className="ml-2 text-ink-500">— 請確認已執行過 pipeline，並把 snapshots 同步到 web/public/data/</span>
          </div>
        )}
        <Routes>
          <Route path="/" element={<HomePage meta={meta} />} />
          <Route path="/map" element={<MapPage meta={meta} />} />
          <Route path="/region" element={<RegionPage meta={meta} />} />
          <Route path="/estimate" element={<EstimatePage meta={meta} />} />
          <Route path="/underpriced" element={<UnderpricedPage meta={meta} />} />
          <Route path="/compare" element={<ComparePage meta={meta} />} />
          <Route path="/browse" element={<BrowsePage meta={meta} />} />
          <Route path="/calc" element={<CalcPage />} />
          <Route path="/about" element={<AboutPage />} />
        </Routes>
      </main>

      {/* —— 頁尾 —— */}
      <footer className="border-t border-ink-200 bg-white">
        <div className="mx-auto max-w-[1300px] px-6 py-6 text-xs text-ink-500">
          <div className="flex items-center justify-between">
            <div>
              本站統計僅供參考，不構成投資、不動產或金融建議。
              {meta && <> · 資料更新 {meta.generated_at?.slice(0, 10)}</>}
            </div>
            <div className="font-serif tracking-tightish">Realprice / fast edition</div>
          </div>
        </div>
      </footer>
    </div>
  );
}
