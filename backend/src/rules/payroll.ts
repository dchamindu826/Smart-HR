/**
 * Payroll engine — pure. All money in integer cents.
 *
 *   earnings  = basic (or daily rate × paid days) + fixed and variable earnings
 *               + adjustments + approved OT + holiday premium
 *   no-pay    = (basic + no-pay-affected earnings) ÷ noPayDivisor × no-pay days
 *   EPF base  = basic + EPF-applicable earnings − their no-pay share
 *   EPF       = 8 % employee (deducted), 12 % employer; ETF 3 % employer
 *   APIT      = progressive bands on (taxable earnings − no-pay)
 *   stamp     = fixed amount when gross is at or above the threshold
 *   net       = gross − all deductions
 *
 * Every rate comes in through `rates`; nothing is hard-coded here.
 * Items marked "verify" in the seed must be confirmed before a live payroll.
 */

import { mulDiv, percent, sum, type Cents } from '../lib/money.js';
import { overtimePay } from './overtime.js';

export interface PayComponent {
  code: string;
  label: string;
  kind: 'EARNING' | 'DEDUCTION';
  amount: Cents;
  epfApplicable: boolean;
  taxable: boolean;
  affectedByNoPay: boolean;
}

export interface TaxBandC {
  from: Cents;
  to: Cents | null;
  rateBp: number;
}

export interface PayRates {
  epfEmployeeBp: number; // 800
  epfEmployerBp: number; // 1200
  etfBp: number; // 300
  otRateBp: number; // 15000 = 1.5×
  otDivisorHours: number; // 240
  noPayDivisorDays: number; // 30
  stampDutyThreshold: Cents; // 2_500_000 = Rs 25,000 (verify)
  stampDuty: Cents; // 2_500 = Rs 25 (verify)
  apitBands: TaxBandC[];
}

export interface PayInput {
  employee: {
    payType: 'MONTHLY' | 'DAILY';
    basic: Cents; // monthly basic, or the daily rate for DAILY
    epfEligible: boolean;
    otEligible: boolean;
  };
  components: PayComponent[];
  adjustments: PayComponent[];
  attendance: {
    paidDays: number; // DAILY: days to pay
    noPayDays: number; // MONTHLY: unpaid absence + no-pay leave
    otMinutes: number; // approved only
    holidayWork: { minutes: number; multiplierBp: number }[]; // 20000 = 2×
  };
  loans: { loanId: string; label: string; installment: Cents; outstanding: Cents }[];
  rates: PayRates;
}

export interface PayLine {
  code: string;
  label: string;
  kind: 'EARNING' | 'DEDUCTION';
  amount: Cents;
  quantity?: string;
  loanId?: string;
}

export interface PayResult {
  lines: PayLine[];
  basic: Cents;
  gross: Cents;
  totalDeductions: Cents;
  net: Cents;
  epfBase: Cents;
  epfEmployee: Cents;
  epfEmployer: Cents;
  etf: Cents;
  apit: Cents;
  stampDuty: Cents;
  taxable: Cents;
  noPay: Cents;
  otPay: Cents;
  holidayPay: Cents;
  warnings: string[];
}

export function apitFor(taxable: Cents, bands: TaxBandC[]): Cents {
  if (taxable <= 0) return 0;
  let tax = 0;
  for (const b of [...bands].sort((a, c) => a.from - c.from)) {
    if (taxable <= b.from) break;
    const top = b.to === null ? taxable : Math.min(taxable, b.to);
    const slice = top - b.from;
    if (slice > 0) tax += percent(slice, b.rateBp);
  }
  return tax;
}

function hm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function days(d: number): string {
  return `${d} day${d === 1 ? '' : 's'}`;
}

export function computePayslip(input: PayInput): PayResult {
  const { employee: e, rates: r, attendance: a } = input;
  const lines: PayLine[] = [];
  const warnings: string[] = [];

  // basic
  let basic: Cents;
  if (e.payType === 'DAILY') {
    basic = mulDiv(e.basic, Math.round(a.paidDays * 10), 10);
    lines.push({ code: 'BASIC', label: 'Basic (daily)', kind: 'EARNING', amount: basic, quantity: days(a.paidDays) });
  } else {
    basic = e.basic;
    lines.push({ code: 'BASIC', label: 'Basic salary', kind: 'EARNING', amount: basic });
  }

  const earnings = [...input.components, ...input.adjustments].filter((c) => c.kind === 'EARNING' && c.amount !== 0);
  const deductions = [...input.components, ...input.adjustments].filter((c) => c.kind === 'DEDUCTION' && c.amount !== 0);
  for (const c of earnings) lines.push({ code: c.code, label: c.label, kind: 'EARNING', amount: c.amount });

  // overtime
  let otPay = 0;
  if (a.otMinutes > 0) {
    if (!e.otEligible) warnings.push('Approved overtime ignored: this employee is not eligible for overtime.');
    else {
      const rateBase = e.payType === 'DAILY' ? e.basic * 30 : e.basic; // daily → monthly equivalent (verify)
      otPay = overtimePay(rateBase, a.otMinutes, r.otDivisorHours, r.otRateBp);
      lines.push({ code: 'OT', label: 'Overtime', kind: 'EARNING', amount: otPay, quantity: hm(a.otMinutes) });
    }
  }

  // holiday premium: the extra part above normal pay, for hours worked on a premium date
  let holidayPay = 0;
  for (const h of a.holidayWork) {
    if (h.minutes <= 0 || h.multiplierBp <= 10_000) continue;
    const rateBase = e.payType === 'DAILY' ? e.basic * 30 : e.basic;
    const extra = overtimePay(rateBase, h.minutes, r.otDivisorHours, h.multiplierBp - 10_000);
    holidayPay += extra;
    lines.push({ code: 'HOLIDAY', label: `Holiday pay (${(h.multiplierBp / 10_000).toFixed(1)}×)`, kind: 'EARNING', amount: extra, quantity: hm(h.minutes) });
  }

  // no-pay (monthly only)
  let noPay = 0;
  let noPayEpf = 0;
  let noPayTax = 0;
  if (e.payType === 'MONTHLY' && a.noPayDays > 0) {
    const tenths = Math.round(a.noPayDays * 10);
    const den = r.noPayDivisorDays * 10;
    const affected = earnings.filter((c) => c.affectedByNoPay);
    const base = basic + sum(affected.map((c) => c.amount));
    const epfBaseAffected = basic + sum(affected.filter((c) => c.epfApplicable).map((c) => c.amount));
    const taxBaseAffected = basic + sum(affected.filter((c) => c.taxable).map((c) => c.amount));
    noPay = Math.min(base, mulDiv(base, tenths, den));
    noPayEpf = Math.min(epfBaseAffected, mulDiv(epfBaseAffected, tenths, den));
    noPayTax = Math.min(taxBaseAffected, mulDiv(taxBaseAffected, tenths, den));
    lines.push({ code: 'NOPAY', label: 'No-pay deduction', kind: 'DEDUCTION', amount: noPay, quantity: days(a.noPayDays) });
  }

  const gross = basic + sum(earnings.map((c) => c.amount)) + otPay + holidayPay;

  // EPF / ETF — OT and holiday premium are not EPF-liable earnings here (verify)
  const epfBase = e.epfEligible ? Math.max(0, basic + sum(earnings.filter((c) => c.epfApplicable).map((c) => c.amount)) - noPayEpf) : 0;
  const epfEmployee = percent(epfBase, r.epfEmployeeBp);
  const epfEmployer = percent(epfBase, r.epfEmployerBp);
  const etf = percent(epfBase, r.etfBp);
  if (epfEmployee > 0) lines.push({ code: 'EPF8', label: `EPF employee (${r.epfEmployeeBp / 100}%)`, kind: 'DEDUCTION', amount: epfEmployee });

  // APIT
  const taxable = Math.max(0, basic + sum(earnings.filter((c) => c.taxable).map((c) => c.amount)) + otPay + holidayPay - noPayTax);
  const apit = apitFor(taxable, r.apitBands);
  if (apit > 0) lines.push({ code: 'APIT', label: 'APIT (PAYE tax)', kind: 'DEDUCTION', amount: apit });

  // stamp duty
  const stampDuty = r.stampDuty > 0 && gross - noPay >= r.stampDutyThreshold ? r.stampDuty : 0;
  if (stampDuty > 0) lines.push({ code: 'STAMP', label: 'Stamp duty', kind: 'DEDUCTION', amount: stampDuty });

  // other deductions
  for (const c of deductions) lines.push({ code: c.code, label: c.label, kind: 'DEDUCTION', amount: c.amount });

  // loans
  for (const l of input.loans) {
    const amt = Math.min(l.installment, l.outstanding);
    if (amt > 0) lines.push({ code: 'LOAN', label: l.label, kind: 'DEDUCTION', amount: amt, loanId: l.loanId });
  }

  const totalDeductions = sum(lines.filter((l) => l.kind === 'DEDUCTION').map((l) => l.amount));
  const net = gross - totalDeductions;
  if (net < 0) warnings.push('Net pay is negative. Reduce a deduction or a loan instalment.');
  if (e.payType === 'MONTHLY' && basic <= 0) warnings.push('Basic salary is zero.');

  return { lines, basic, gross, totalDeductions, net, epfBase, epfEmployee, epfEmployer, etf, apit, stampDuty, taxable, noPay, otPay, holidayPay, warnings };
}
