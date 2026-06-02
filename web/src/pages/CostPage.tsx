import { useMemo, useState } from "react";
import { consolidatedTax } from "../lib/calc";
import { fmt, fmtWan } from "../lib/format";
import Section from "../components/Section";
import { Kpi, KpiBar } from "../components/KpiBar";
import { useSearchParams } from "react-router-dom";

type Mode = "buy" | "sell";

export default function CostPage() {
  const [params] = useSearchParams();
  const [mode, setMode] = useState<Mode>("buy");
  const initPrice = (() => {
    const p = Number(params.get("price"));
    return Number.isFinite(p) && p > 0 ? p : 2000;
  })();

  return (
    <div className="space-y-6">
      <section className="panel p-8">
        <div className="label">Closing Costs · 交易成本</div>
        <h1 className="mt-2 font-serif text-3xl text-ink-900">買賣房子，除了房價還要準備多少？</h1>
        <p className="mt-3 max-w-2xl text-ink-600 leading-7">
          房價只是檯面上的數字。<strong>買方</strong>要再準備契稅、代書、設定、仲介、火險；
          <strong>賣方</strong>則被仲介費、土增稅、<strong>房地合一稅</strong>吃掉一塊。
          這裡把兩邊一次算清楚 —— 全部在你的瀏覽器計算，不送伺服器。
        </p>
        <div className="mt-5 inline-flex rounded-md border border-ink-200 overflow-hidden text-sm">
          <button onClick={() => setMode("buy")}
            className={`px-4 py-2 ${mode === "buy" ? "bg-ink-900 text-white" : "bg-white text-ink-600 hover:bg-ink-50"}`}>
            我是買方
          </button>
          <button onClick={() => setMode("sell")}
            className={`px-4 py-2 border-l border-ink-200 ${mode === "sell" ? "bg-ink-900 text-white" : "bg-white text-ink-600 hover:bg-ink-50"}`}>
            我是賣方
          </button>
        </div>
      </section>

      {mode === "buy" ? <BuyerCost initPrice={initPrice} /> : <SellerCost initPrice={initPrice} />}

      <Section kicker="重要說明" title="這些數字怎麼來的">
        <ul className="text-sm leading-7 text-ink-700 list-disc pl-5">
          <li><strong>契稅</strong>＝房屋評定現值 × 6%。房屋評定現值遠低於成交價，本工具用「佔成交價比例」估算（預設 8%，老屋更低），實際以稅單為準。</li>
          <li><strong>土增稅、房屋現值</strong>因人因屋差異極大，本工具為<strong>概算</strong>，正式金額請洽地政士（代書）與稅捐處。</li>
          <li><strong>房地合一稅 2.0</strong>：境內個人持有 ≤2年 45%、2~5年 35%、5~10年 20%、&gt;10年 15%；符合自住要件者課稅所得 400 萬內免稅、超過 10%。</li>
          <li>仲介費為上限參考（買方 ≤ 2%、賣方 ≤ 4%，合計 ≤ 6%），可議。自售則為 0。</li>
        </ul>
      </Section>
    </div>
  );
}

function NumberField({ label, value, set, suffix, step = 1, hint }: {
  label: string; value: number; set: (n: number) => void; suffix?: string; step?: number; hint?: string;
}) {
  return (
    <div>
      <div className="text-sm text-ink-700 mb-1">{label}</div>
      <div className="flex items-center gap-2">
        <input type="number" className="input flex-1" value={value} step={step}
          onChange={e => set(e.target.value === "" ? 0 : +e.target.value)} />
        {suffix && <span className="text-sm text-ink-500 shrink-0">{suffix}</span>}
      </div>
      {hint && <div className="text-[11px] text-ink-400 mt-1">{hint}</div>}
    </div>
  );
}

function CostRow({ k, v, hint, strong }: { k: string; v: number; hint?: string; strong?: boolean }) {
  return (
    <div className={`flex items-start justify-between gap-4 border-b border-dotted border-ink-200 py-2 last:border-0 ${strong ? "font-medium" : ""}`}>
      <div>
        <span className={strong ? "text-ink-900" : "text-ink-700"}>{k}</span>
        {hint && <div className="text-[11px] text-ink-400">{hint}</div>}
      </div>
      <span className={`stat-num whitespace-nowrap ${strong ? "text-ink-900 text-base" : "text-ink-700"}`}>
        {fmt(Math.round(v))} 元
      </span>
    </div>
  );
}

// ─────────────────────────── 買方 ───────────────────────────
function BuyerCost({ initPrice }: { initPrice: number }) {
  const [price, setPrice] = useState(initPrice);          // 萬
  const [downPct, setDownPct] = useState(20);
  const [feeRate, setFeeRate] = useState(1);              // 仲介費 %（買方）
  const [housePct, setHousePct] = useState(8);            // 房屋評定現值佔成交價 %（估契稅用）
  const [scrivener, setScrivener] = useState(15000);      // 代書費
  const [insurance, setInsurance] = useState(4000);       // 火險地震險（年）

  const total = price * 10000;
  const loan = total * (1 - downPct / 100);
  const setupAmt = loan * 1.2;                            // 抵押權設定金額 = 貸款 ×1.2

  const items = useMemo(() => {
    const houseValue = total * housePct / 100;
    const deed = houseValue * 0.06;                       // 契稅 6%
    const stamp = (houseValue + total * 0.5) * 0.001;     // 印花稅 0.1%（概算：房屋現值+土地現值）
    const regFee = houseValue * 0.001;                    // 登記規費 0.1%
    const agentFee = total * feeRate / 100;               // 仲介費
    const setupFee = setupAmt * 0.001;                    // 抵押權設定登記規費 0.1%
    const bankFee = 6000;                                 // 銀行開辦/鑑估費（概估）
    const escrow = total * 0.0006;                        // 履約保證費 萬分之6（買賣各半，這裡列買方半）
    return [
      { k: "契稅", v: deed, hint: `房屋評定現值（估 ${housePct}% = ${fmtWan(houseValue, 0)} 萬）× 6%` },
      { k: "印花稅", v: stamp, hint: "房屋現值 + 土地現值 × 0.1%（概算）" },
      { k: "登記規費", v: regFee, hint: "房屋現值 × 0.1%" },
      { k: "代書費（買方）", v: scrivener, hint: "地政士辦過戶、設定" },
      { k: "抵押權設定規費", v: setupFee, hint: `設定金額 ${fmtWan(setupAmt, 0)} 萬 × 0.1%` },
      { k: "銀行開辦／鑑估費", v: bankFee, hint: "各行庫不一，概估" },
      { k: "履約保證費", v: escrow, hint: "成交價 萬分之6（買方半）" },
      { k: "仲介費（買方）", v: agentFee, hint: `成交價 × ${feeRate}%（可議，自售為 0）` },
      { k: "火險＋地震險（首年）", v: insurance, hint: "貸款銀行通常要求投保" },
    ];
  }, [total, housePct, feeRate, scrivener, insurance, setupAmt]);

  const closing = items.reduce((a, c) => a + c.v, 0);
  const down = total * downPct / 100;
  const cashNeeded = down + closing;

  return (
    <>
      <Section kicker="買方輸入" title="交易條件">
        <div className="grid gap-4 md:grid-cols-3">
          <NumberField label="成交價" value={price} set={setPrice} suffix="萬" step={50} />
          <NumberField label="自備款比例" value={downPct} set={setDownPct} suffix="%" />
          <NumberField label="仲介費率（買方）" value={feeRate} set={setFeeRate} suffix="%" step={0.5} hint="向買方收，上限 2%，可議" />
          <NumberField label="房屋現值佔成交價" value={housePct} set={setHousePct} suffix="%" hint="估契稅用，新屋約 8~15%、老屋更低" />
          <NumberField label="代書費" value={scrivener} set={setScrivener} suffix="元" step={1000} />
          <NumberField label="火險＋地震險" value={insurance} set={setInsurance} suffix="元/年" step={500} />
        </div>
      </Section>

      <Section kicker="買方結果" title="總共要準備的現金">
        <KpiBar>
          <Kpi label="自備款" value={`${fmtWan(down, 0)} 萬`} sub={`成交價 ${downPct}%`} />
          <Kpi label="交易雜費合計" value={`${fmtWan(closing, 0)} 萬`} sub="契稅+代書+仲介+設定…" accent="down" />
          <Kpi label="開頭現金合計" value={`${fmtWan(cashNeeded, 0)} 萬`} sub="自備款 + 交易雜費" accent="default" />
          <Kpi label="雜費佔成交價" value={`${(closing / total * 100).toFixed(1)}%`} sub="不含自備款" />
        </KpiBar>
        <div className="mt-6 rounded-md border border-ink-200 bg-white p-4 max-w-2xl">
          <div className="label mb-2">買方成本明細</div>
          {items.map(it => <CostRow key={it.k} {...it} />)}
          <CostRow k="交易雜費合計" v={closing} strong />
        </div>
        <p className="mt-3 text-sm text-ink-600 max-w-2xl">
          要買 <strong>{fmt(price)} 萬</strong>的房子，扣掉貸款後，開頭大約得準備
          <strong className="text-accent"> {fmtWan(cashNeeded, 0)} 萬</strong>現金
          （自備 {fmtWan(down, 0)} 萬 + 雜費 {fmtWan(closing, 0)} 萬）。
        </p>
      </Section>
    </>
  );
}

// ─────────────────────────── 賣方 ───────────────────────────
function SellerCost({ initPrice }: { initPrice: number }) {
  const [price, setPrice] = useState(initPrice);          // 售價 萬
  const [acquire, setAcquire] = useState(Math.round(initPrice * 0.7)); // 當初買入 萬
  const [holdYears, setHoldYears] = useState(6);
  const [selfUse, setSelfUse] = useState(false);
  const [feeRate, setFeeRate] = useState(4);              // 仲介費 %（賣方）
  const [loanLeft, setLoanLeft] = useState(0);            // 房貸餘額 萬
  const [landTax, setLandTax] = useState(0);              // 土增稅 萬（概算，使用者填）
  const [scrivener, setScrivener] = useState(0);          // 賣方代書（多由買方付，預設0）

  const sale = price * 10000;
  const cost = acquire * 10000;
  const agentFee = sale * feeRate / 100;
  // 房地合一必要費用：仲介費 + 土增稅 + 代書 +（裝修等概估，這裡用仲介費已含）
  const expenses = agentFee + landTax * 10000 + scrivener;
  const cgt = consolidatedTax(sale, cost, expenses, holdYears, selfUse);

  const totalCost = agentFee + landTax * 10000 + scrivener + cgt.tax;
  const net = sale - totalCost - loanLeft * 10000;
  const grossGain = sale - cost;

  return (
    <>
      <Section kicker="賣方輸入" title="交易條件">
        <div className="grid gap-4 md:grid-cols-3">
          <NumberField label="預計售價" value={price} set={setPrice} suffix="萬" step={50} />
          <NumberField label="當初買入價" value={acquire} set={setAcquire} suffix="萬" step={50} hint="房地合一稅的取得成本" />
          <NumberField label="持有年數" value={holdYears} set={setHoldYears} suffix="年" hint="決定房地合一稅率" />
          <NumberField label="仲介費率（賣方）" value={feeRate} set={setFeeRate} suffix="%" step={0.5} hint="向賣方收，上限 4%，可議" />
          <NumberField label="房貸餘額" value={loanLeft} set={setLoanLeft} suffix="萬" step={50} hint="售屋款需先清償" />
          <NumberField label="土地增值稅（概估）" value={landTax} set={setLandTax} suffix="萬" step={5} hint="依公告現值增額，請洽稅捐處" />
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" checked={selfUse} onChange={e => setSelfUse(e.target.checked)} />
          符合<strong>自用住宅</strong>要件（本人或配偶/子女設籍且持有滿 6 年、無出租營業）→ 課稅所得 400 萬免稅、超過 10%
        </label>
      </Section>

      <Section kicker="賣方結果" title="賣掉之後，實際拿回多少？">
        <KpiBar>
          <Kpi label="帳面增值" value={`${fmtWan(grossGain, 0)} 萬`} sub={`售 ${fmt(price)} − 買 ${fmt(acquire)}`}
               accent={grossGain >= 0 ? "up" : "down"} />
          <Kpi label="房地合一稅" value={`${fmtWan(cgt.tax, 0)} 萬`} sub={`稅率 ${(cgt.rate * 100).toFixed(0)}%${selfUse ? "（自住）" : ""}`} accent="down" />
          <Kpi label="交易成本合計" value={`${fmtWan(totalCost, 0)} 萬`} sub="仲介+土增+房地合一+代書" accent="down" />
          <Kpi label="實際淨拿回" value={`${fmtWan(net, 0)} 萬`} sub="已扣成本與房貸餘額" accent="default" />
        </KpiBar>
        <div className="mt-6 rounded-md border border-ink-200 bg-white p-4 max-w-2xl">
          <div className="label mb-2">賣方成本明細</div>
          <CostRow k="仲介費（賣方）" v={agentFee} hint={`售價 × ${feeRate}%`} />
          <CostRow k="土地增值稅" v={landTax * 10000} hint="使用者概估值" />
          <CostRow k="賣方代書／雜費" v={scrivener} />
          <CostRow k={`房地合一稅（課稅所得 ${fmtWan(cgt.taxable, 0)} 萬 × ${(cgt.rate * 100).toFixed(0)}%）`} v={cgt.tax}
                   hint={`售價 − 取得成本 − 必要費用${selfUse ? " − 自住免稅 400 萬" : ""}`} />
          <CostRow k="交易成本合計" v={totalCost} strong />
        </div>
        <p className="mt-3 text-sm text-ink-600 max-w-2xl">
          以 <strong>{fmt(price)} 萬</strong>賣出、當初 <strong>{fmt(acquire)} 萬</strong>買進、持有 {holdYears} 年，
          扣掉各項成本與房貸餘額 {fmt(loanLeft)} 萬後，實際淨拿回約
          <strong className="text-accent"> {fmtWan(net, 0)} 萬</strong>。
          {grossGain > 0 && cgt.tax > 0 && <>（光房地合一稅就吃掉增值的 {(cgt.tax / grossGain * 100).toFixed(0)}%）</>}
        </p>
      </Section>
    </>
  );
}
