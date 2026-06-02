import { useEffect, useRef, useState } from "react";

const prefersReduced = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** 數字跳動：進入視窗後從目前值緩動到目標值。
 *  value 在資料抵達後才從 null/0 變成真值 —— 會自動重新播放到新值，不會卡住。 */
export default function CountUp({
  value, format = (n) => Math.round(n).toLocaleString("en-US"),
  duration = 1100, className = "",
}: {
  value: number | null | undefined;
  format?: (n: number) => string;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [inView, setInView] = useState(false);
  const [display, setDisplay] = useState(0);
  const displayRef = useRef(0);
  const rafRef = useRef(0);

  // 進入視窗一次即記錄
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setInView(true); io.disconnect(); }
    }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // value 或 inView 改變時，從目前顯示值緩動到目標
  useEffect(() => {
    if (value == null || !Number.isFinite(value)) return;
    if (!inView) return;
    if (prefersReduced()) { displayRef.current = value; setDisplay(value); return; }

    cancelAnimationFrame(rafRef.current);
    const from = displayRef.current;
    const to = value;
    const t0 = performance.now();
    const ease = (t: number) => 1 - Math.pow(1 - t, 3); // easeOutCubic
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const v = from + (to - from) * ease(p);
      displayRef.current = v;
      setDisplay(v);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, inView, duration]);

  return (
    <span ref={ref} className={className}>
      {value == null ? "—" : format(display)}
    </span>
  );
}
