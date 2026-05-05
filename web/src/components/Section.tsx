import { ReactNode } from "react";

export default function Section({
  title, kicker, right, children,
}: {
  title: ReactNode;
  kicker?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          {kicker && <div className="label mb-1">{kicker}</div>}
          <h2 className="font-serif text-xl text-ink-900">{title}</h2>
        </div>
        {right && <div>{right}</div>}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}
