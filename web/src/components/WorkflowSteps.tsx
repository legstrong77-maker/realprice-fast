import { Link } from "react-router-dom";

const STEPS = [
  { to: "/dashboard", label: "找候選區", desc: "用預算與坪數篩出優先看屋區域" },
  { to: "/compare", label: "比較區域", desc: "把 2-5 個行政區放在一起看" },
  { to: "/report", label: "買房報告", desc: "整理優缺點、風險與 AI 分析資料" },
  { to: "/estimate", label: "估合理價", desc: "用 P25/P50/P75 建立出價帶" },
  { to: "/browse", label: "查成交", desc: "回到原始成交檢查個案" },
  { to: "/calc", label: "算負擔", desc: "確認月付與自備款壓力" },
];

export default function WorkflowSteps({ pathname }: { pathname: string }) {
  const active = STEPS.findIndex((s) => pathname.startsWith(s.to));
  if (pathname === "/" || pathname.startsWith("/about")) return null;

  return (
    <div className="mb-6 rounded-lg border border-ink-200 bg-white px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <div className="label">買房流程</div>
          <div className="text-sm text-ink-600">從預算到個案檢查，一步一步縮小範圍。</div>
        </div>
        {active >= 0 && active < STEPS.length - 1 && (
          <Link to={STEPS[active + 1].to} className="btn hidden shrink-0 md:inline-flex">
            下一步：{STEPS[active + 1].label}
          </Link>
        )}
      </div>
      <div className="grid gap-2 md:grid-cols-6">
        {STEPS.map((step, i) => {
          const isActive = i === active;
          const isDone = active > i;
          return (
            <Link
              key={step.to}
              to={step.to}
              className={`rounded-md border px-3 py-2 transition ${
                isActive
                  ? "border-ink-900 bg-ink-900 text-white"
                  : isDone
                    ? "border-accent/30 bg-accent/5 text-ink-900"
                    : "border-ink-200 bg-white text-ink-700 hover:border-ink-300 hover:bg-ink-50"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                  isActive ? "bg-white text-ink-900" : "bg-ink-100 text-ink-600"
                }`}>
                  {i + 1}
                </span>
                <span className="text-sm font-medium">{step.label}</span>
              </div>
              <div className={`mt-1 text-xs leading-5 ${isActive ? "text-white/75" : "text-ink-500"}`}>
                {step.desc}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
