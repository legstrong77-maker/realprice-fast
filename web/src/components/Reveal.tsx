import { useEffect, useRef, useState, type ReactNode, type ElementType } from "react";

const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** 進場動畫包裝：元素接近視窗時加 .is-in 觸發 fade-up。
 *  穩健設計 —— 內容永遠不會卡在隱形：
 *   1) 不支援 IntersectionObserver / 偏好減少動態 → 直接顯示
 *   2) mount 時已在（或接近）視窗 → 立即顯示
 *   3) 其餘交給 observer；另有安全 timeout 保底，scroll 沒觸發也會顯示 */
export default function Reveal({
  children, as: Tag = "div", delay, className = "",
}: {
  children: ReactNode;
  as?: ElementType;
  delay?: 1 | 2 | 3 | 4 | 5 | 6;
  className?: string;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) { setShown(true); return; }
    if (reducedMotion() || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const nearView = () => {
      const r = el.getBoundingClientRect();
      return r.top < window.innerHeight * 1.15 && r.bottom > 0;
    };
    if (nearView()) { setShown(true); return; }

    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect(); clearTimeout(timer); } },
      { threshold: 0.08, rootMargin: "0px 0px -4% 0px" },
    );
    io.observe(el);
    // 保底：1.4s 後一律顯示，避免任何情況下內容隱形
    const timer = setTimeout(() => { setShown(true); io.disconnect(); }, 1400);
    return () => { io.disconnect(); clearTimeout(timer); };
  }, []);

  return (
    <Tag
      ref={ref}
      className={`reveal ${delay ? `reveal-${delay}` : ""} ${shown ? "is-in" : ""} ${className}`}
    >
      {children}
    </Tag>
  );
}
