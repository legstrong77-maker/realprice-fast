/** 格式化工具 — 全站數字一致 */

export function fmt(n: number | null | undefined, digits = 0): string {
  if (n == null || isNaN(n as number)) return "—";
  return Number(n).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** 元 → 萬 */
export function toWan(n: number | null | undefined): number | null {
  if (n == null || isNaN(n as number)) return null;
  return n / 10_000;
}

/** 元 → 萬（顯示字串，已四捨五入） */
export function fmtWan(n: number | null | undefined, digits = 0): string {
  const w = toWan(n);
  return w == null ? "—" : fmt(w, digits);
}

/** 單價/坪 → 萬/坪（一位小數） */
export function fmtPing(n: number | null | undefined): string {
  return fmtWan(n, 1);
}

/** 0.123 → +12.3% / -12.3% */
export function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null || isNaN(n as number)) return "—";
  const x = (n as number) * 100;
  const sign = x > 0 ? "+" : "";
  return `${sign}${x.toFixed(digits)}%`;
}

export function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  return s.slice(0, 10);
}
