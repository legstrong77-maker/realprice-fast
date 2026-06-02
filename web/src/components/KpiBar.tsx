import { ReactNode } from "react";

export function Kpi({
  label, value, sub, accent,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: "up" | "down" | "default";
}) {
  const color =
    accent === "up" ? "text-up"
    : accent === "down" ? "text-down"
    : accent === "default" ? "text-brass-600"
    : "text-ink-900";

  return (
    <div className="group relative px-5 py-4 transition-colors duration-200 hover:bg-brass-50/40">
      <div className="label">{label}</div>
      <div className={`mt-2 stat-num text-[26px] leading-none ${color}`}>{value}</div>
      {sub && <div className="mt-1.5 text-xs text-ink-500">{sub}</div>}
    </div>
  );
}

export function KpiBar({ children }: { children: ReactNode }) {
  return (
    <div className="panel grid grid-cols-2 divide-x divide-y divide-ink-200/70 overflow-hidden md:grid-cols-4 md:divide-y-0">
      {children}
    </div>
  );
}
