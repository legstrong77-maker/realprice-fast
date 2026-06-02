import { ReactNode } from "react";

/** 角色頁開頭：左文右圖（精品誌風）。圖缺席時左側照常顯示，右側留白。
 *  桌機顯示框圖，手機隱藏圖只留文字。 */
export default function RoleHero({
  kicker, title, img, children,
}: {
  kicker: string;
  title: ReactNode;
  img: string;
  children: ReactNode;
}) {
  return (
    <section className="panel overflow-hidden animate-scale-in">
      <div className="grid lg:grid-cols-[1.35fr_1fr]">
        <div className="p-8 lg:py-10">
          <div className="kicker">{kicker}</div>
          <h1 className="display mt-3 text-[30px] leading-tight text-ink-900 lg:text-4xl">{title}</h1>
          <div className="mt-4 max-w-2xl text-[15px] leading-7 text-ink-600">{children}</div>
        </div>
        <div className="relative hidden min-h-[200px] overflow-hidden lg:block">
          <img
            src={img}
            alt=""
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
          />
          {/* 左側暖紙漸層融接 + 底部暗角，讓接縫自然 */}
          <div
            className="absolute inset-0"
            style={{ background: "linear-gradient(90deg, #fdfbf6 0%, rgba(253,251,246,0.35) 28%, transparent 60%)" }}
          />
          <div className="absolute inset-0 ring-1 ring-inset ring-ink-900/5" />
        </div>
      </div>
    </section>
  );
}
