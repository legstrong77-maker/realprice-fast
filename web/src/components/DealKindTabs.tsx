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
    <div className="inline-flex items-center gap-1 rounded-md border border-ink-200 bg-white p-1">
      {(["sale", "presale", "rent"] as DealKind[]).map((k) => (
        <button
          key={k}
          className={`btn !border-transparent ${value === k ? "btn-active" : ""}`}
          onClick={() => onChange(k)}
        >
          {LABELS[k]}
        </button>
      ))}
    </div>
  );
}
