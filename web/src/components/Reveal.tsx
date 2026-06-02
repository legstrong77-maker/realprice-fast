import { useEffect, useRef, useState, type ReactNode, type ElementType } from "react";

/** 進場動畫包裝：元素進入視窗時加上 .is-in 觸發 fade-up。
 *  delay 1–6 對應 styles.css 的 .reveal-N 階梯延遲（做 stagger 用）。 */
export default function Reveal({
  children, as: Tag = "div", delay, className = "", once = true,
}: {
  children: ReactNode;
  as?: ElementType;
  delay?: 1 | 2 | 3 | 4 | 5 | 6;
  className?: string;
  once?: boolean;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setShown(true);
          if (once) io.disconnect();
        } else if (!once) {
          setShown(false);
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [once]);

  return (
    <Tag
      ref={ref}
      className={`reveal ${delay ? `reveal-${delay}` : ""} ${shown ? "is-in" : ""} ${className}`}
    >
      {children}
    </Tag>
  );
}
