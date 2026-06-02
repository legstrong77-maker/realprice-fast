import type { DealKind } from "../lib/data";

const LABELS: Record<DealKind, string> = {
  sale: "不動產買賣",
  presale: "預售屋",
  rent: "租賃",
};

export default function DealKindTabs({
  value, onChange,
}: {
  value: DealKind;
  onChange: (v: DealKind) => void;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border border-ink-200 bg-ink-100/60 p-1">
      {(["sale", "presale", "rent"] as DealKind[]).map((k) => (
        <button
          key={k}
          className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition-all duration-200
            ${value === k
              ? "bg-ink-900 text-ink-50 shadow-sm"
              : "text-ink-500 hover:text-brass-700"}`}
          onClick={() => onChange(k)}
        >
          {LABELS[k]}
        </button>
      ))}
    </div>
  );
}
