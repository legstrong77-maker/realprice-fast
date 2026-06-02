import { ReactNode } from "react";
import Reveal from "./Reveal";

export default function Section({
  title, kicker, right, children,
}: {
  title: ReactNode;
  kicker?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Reveal as="section" className="panel">
      <div className="panel-head">
        <div>
          {kicker && <div className="kicker mb-1.5">{kicker}</div>}
          <h2 className="font-serif text-[22px] leading-tight text-ink-900">{title}</h2>
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </div>
      <div className="p-5">{children}</div>
    </Reveal>
  );
}
