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
    : "text-ink-900";

  return (
    <div className="px-5 py-4">
      <div className="label">{label}</div>
      <div className={`mt-1.5 stat-num text-2xl ${color}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-ink-500">{sub}</div>}
    </div>
  );
}

export function KpiBar({ children }: { children: ReactNode }) {
  return (
    <div className="panel grid grid-cols-2 divide-x divide-ink-200 md:grid-cols-4">
      {children}
    </div>
  );
}
