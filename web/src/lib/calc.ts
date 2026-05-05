/** 試算邏輯 — 純函式、純前端，無後端依賴。 */

/** 標準等額本息月付（一般房貸計算） */
export function monthlyPayment(principal: number, annualRate: number, years: number): number {
  if (principal <= 0 || years <= 0) return 0;
  const r = annualRate / 12;
  const n = years * 12;
  if (r === 0) return principal / n;
  return principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

/** 攤還明細（簡化版：每年總計） */
export function amortizationByYear(
  principal: number, annualRate: number, years: number,
): { year: number; principal_paid: number; interest_paid: number; balance: number }[] {
  const r = annualRate / 12;
  const m = monthlyPayment(principal, annualRate, years);
  let balance = principal;
  const out: any[] = [];
  for (let y = 1; y <= years; y++) {
    let p_paid = 0, i_paid = 0;
    for (let mo = 0; mo < 12; mo++) {
      const interest = balance * r;
      const principal_part = m - interest;
      balance -= principal_part;
      p_paid += principal_part;
      i_paid += interest;
    }
    out.push({
      year: y,
      principal_paid: p_paid,
      interest_paid: i_paid,
      balance: Math.max(0, balance),
    });
  }
  return out;
}

/** 可負擔房價：給月收 + 年限 + 利率 + DTI 上限 + 自備款，倒推合理總價。 */
export function affordablePrice(
  monthlyIncome: number, annualRate: number, years: number,
  dtiLimit = 0.35, downPayment = 0,
): { totalPrice: number; loanPrincipal: number; monthlyPay: number } {
  const maxMonthly = monthlyIncome * dtiLimit;
  // 反推 principal: m = P * r(1+r)^n / ((1+r)^n - 1)
  const r = annualRate / 12;
  const n = years * 12;
  let principal: number;
  if (r === 0) {
    principal = maxMonthly * n;
  } else {
    principal = maxMonthly * (Math.pow(1 + r, n) - 1) / (r * Math.pow(1 + r, n));
  }
  return {
    loanPrincipal: principal,
    totalPrice: principal + downPayment,
    monthlyPay: maxMonthly,
  };
}

/** 升息壓力測試：一個 base + 多個 delta，回傳對照表。 */
export function stressTest(
  principal: number, baseRate: number, years: number,
  deltas: number[] = [0, 0.005, 0.01, 0.015, 0.02],
): { rate: number; monthly: number; total_interest: number; delta_monthly: number }[] {
  const base = monthlyPayment(principal, baseRate, years);
  return deltas.map(d => {
    const m = monthlyPayment(principal, baseRate + d, years);
    const total = m * years * 12 - principal;
    return {
      rate: baseRate + d,
      monthly: m,
      total_interest: Math.max(0, total),
      delta_monthly: m - base,
    };
  });
}
