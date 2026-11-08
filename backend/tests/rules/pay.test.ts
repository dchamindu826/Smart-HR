import { describe, expect, it } from 'vitest';
import { apitFor, computePayslip, type PayInput, type TaxBandC } from '../../src/rules/payroll.js';
import { checkWeeklyCap, overtimePay, validReason } from '../../src/rules/overtime.js';
import { gratuity } from '../../src/rules/gratuity.js';
import { countLeaveDays, entitlement, available } from '../../src/rules/leave.js';
import { fromCents, mulDiv, toCents, formatLkr } from '../../src/lib/money.js';
import { totpAt, verifyTotp, base32Encode } from '../../src/rules/totp.js';
import { isoWeekday } from '../../src/lib/time.js';

const R = (rupees: number) => Math.round(rupees * 100);

// Monthly APIT bands used for tests (same as the seed; verify before live use).
const bands: TaxBandC[] = [
  { from: R(0), to: R(150_000), rateBp: 0 },
  { from: R(150_000), to: R(233_333), rateBp: 600 },
  { from: R(233_333), to: R(275_000), rateBp: 1800 },
  { from: R(275_000), to: R(316_667), rateBp: 2400 },
  { from: R(316_667), to: R(358_333), rateBp: 3000 },
  { from: R(358_333), to: null, rateBp: 3600 },
];

const rates = {
  epfEmployeeBp: 800,
  epfEmployerBp: 1200,
  etfBp: 300,
  otRateBp: 15000,
  otDivisorHours: 240,
  noPayDivisorDays: 30,
  stampDutyThreshold: R(25_000),
  stampDuty: R(25),
  apitBands: bands,
};

function input(over: Partial<PayInput> = {}): PayInput {
  return {
    employee: { payType: 'MONTHLY', basic: R(60_000), epfEligible: true, otEligible: true },
    components: [],
    adjustments: [],
    attendance: { paidDays: 0, noPayDays: 0, otMinutes: 0, holidayWork: [] },
    loans: [],
    rates,
    ...over,
  };
}

describe('money', () => {
  it('parses and formats without floating point drift', () => {
    expect(toCents('0.1') + toCents('0.2')).toBe(toCents('0.3'));
    expect(toCents('12,345.505')).toBe(1234551);
    expect(fromCents(1234550)).toBe('12345.50');
    expect(formatLkr(123456789)).toBe('1,234,567.89');
    expect(fromCents(-5)).toBe('-0.05');
  });
  it('mulDiv rounds half up and stays exact for large values', () => {
    expect(mulDiv(5, 1, 2)).toBe(3);
    expect(mulDiv(1_000_000_000_00, 15000 * 6000, 240 * 10000 * 60)).toBe(62_500_000_000);
  });
});

describe('APIT', () => {
  it('nothing up to Rs 150,000', () => {
    expect(apitFor(R(150_000), bands)).toBe(0);
  });
  it('6 % on the next slice', () => {
    expect(apitFor(R(200_000), bands)).toBe(R(3_000));
  });
});

describe('computePayslip', () => {
  it('basic only: EPF 8 % deducted, 12 % + 3 % employer, stamp duty', () => {
    const r = computePayslip(input());
    expect(r.gross).toBe(R(60_000));
    expect(r.epfEmployee).toBe(R(4_800));
    expect(r.epfEmployer).toBe(R(7_200));
    expect(r.etf).toBe(R(1_800));
    expect(r.stampDuty).toBe(R(25));
    expect(r.apit).toBe(0);
    expect(r.net).toBe(R(60_000 - 4_800 - 25));
  });

  it('EPF only on EPF-applicable allowances', () => {
    const r = computePayslip(
      input({
        components: [
          { code: 'BRA', label: 'Budgetary relief', kind: 'EARNING', amount: R(3_500), epfApplicable: true, taxable: true, affectedByNoPay: true },
          { code: 'TRV', label: 'Travelling', kind: 'EARNING', amount: R(5_000), epfApplicable: false, taxable: true, affectedByNoPay: false },
        ],
      }),
    );
    expect(r.epfBase).toBe(R(63_500));
    expect(r.gross).toBe(R(68_500));
  });

  it('overtime: basic ÷ 240 × 1.5 per hour', () => {
    const r = computePayslip(input({ attendance: { paidDays: 0, noPayDays: 0, otMinutes: 600, holidayWork: [] } }));
    // 60,000 / 240 = 250 per hour × 1.5 = 375 × 10 h = 3,750
    expect(r.otPay).toBe(R(3_750));
    expect(r.epfBase).toBe(R(60_000));
  });

  it('holiday premium at 2× pays one extra hourly rate per hour worked', () => {
    const r = computePayslip(input({ attendance: { paidDays: 0, noPayDays: 0, otMinutes: 0, holidayWork: [{ minutes: 480, multiplierBp: 20000 }] } }));
    expect(r.holidayPay).toBe(R(2_000)); // 250 × 8
  });

  it('no-pay days reduce pay and the EPF base', () => {
    const r = computePayslip(input({ attendance: { paidDays: 0, noPayDays: 2, otMinutes: 0, holidayWork: [] } }));
    expect(r.noPay).toBe(R(4_000)); // 60,000 / 30 × 2
    expect(r.epfBase).toBe(R(56_000));
    expect(r.net).toBe(R(60_000 - 4_000 - 4_480 - 25));
  });

  it('half no-pay day', () => {
    const r = computePayslip(input({ attendance: { paidDays: 0, noPayDays: 0.5, otMinutes: 0, holidayWork: [] } }));
    expect(r.noPay).toBe(R(1_000));
  });

  it('loan instalment never exceeds the outstanding balance', () => {
    const r = computePayslip(input({ loans: [{ loanId: 'l1', label: 'Staff loan', installment: R(5_000), outstanding: R(2_000) }] }));
    expect(r.lines.find((l) => l.code === 'LOAN')?.amount).toBe(R(2_000));
  });

  it('daily-paid employee: rate × days', () => {
    const r = computePayslip(input({ employee: { payType: 'DAILY', basic: R(2_500), epfEligible: true, otEligible: false }, attendance: { paidDays: 22, noPayDays: 0, otMinutes: 0, holidayWork: [] } }));
    expect(r.basic).toBe(R(55_000));
  });

  it('APIT for a high earner', () => {
    const r = computePayslip(input({ employee: { payType: 'MONTHLY', basic: R(250_000), epfEligible: true, otEligible: false } }));
    // 83,333 × 6 % = 4,999.98; 16,667 × 18 % = 3,000.06 → 8,000.04
    expect(r.apit).toBe(R(8_000.04));
  });

  it('OT not paid to a non-eligible employee, with a warning', () => {
    const r = computePayslip(input({ employee: { payType: 'MONTHLY', basic: R(60_000), epfEligible: true, otEligible: false }, attendance: { paidDays: 0, noPayDays: 0, otMinutes: 120, holidayWork: [] } }));
    expect(r.otPay).toBe(0);
    expect(r.warnings.length).toBe(1);
  });

  it('net = gross − deductions always', () => {
    const r = computePayslip(
      input({
        components: [{ code: 'WEL', label: 'Welfare', kind: 'DEDUCTION', amount: R(500), epfApplicable: false, taxable: false, affectedByNoPay: false }],
        attendance: { paidDays: 0, noPayDays: 1, otMinutes: 90, holidayWork: [] },
      }),
    );
    expect(r.net).toBe(r.gross - r.totalDeductions);
  });
});

describe('overtime', () => {
  it('needs a reason of at least 10 characters', () => {
    expect(validReason('busy')).toBe(false);
    expect(validReason('Stock count for month end')).toBe(true);
  });
  it('weekly cap: 12 h allowed, one minute more refused', () => {
    expect(checkWeeklyCap(600, 120, 720).allowed).toBe(true);
    expect(checkWeeklyCap(600, 121, 720).allowed).toBe(false);
  });
  it('pay is exact', () => {
    expect(overtimePay(R(48_000), 60, 240, 15000)).toBe(R(300));
  });
});

describe('gratuity', () => {
  it('nothing payable before 5 years, but the liability accrues', () => {
    const g = gratuity('2022-01-01', '2026-10-01', R(80_000));
    expect(g).toMatchObject({ years: 4, eligible: false, amount: 0, liability: R(160_000) });
  });
  it('half a month per completed year after 5 years', () => {
    expect(gratuity('2016-03-15', '2026-03-15', R(100_000)).amount).toBe(R(500_000));
  });
});

describe('leave', () => {
  const ent = (rule: 'STATUTORY_ANNUAL' | 'STATUTORY_CASUAL', joinDate: string, year: number, asOf = `${year}-12-31`) =>
    entitlement({ rule, daysPerYear: 0, joinDate, year, asOf });
  it('annual: none in the joining year', () => {
    expect(ent('STATUTORY_ANNUAL', '2026-02-10', 2026)).toBe(0);
  });
  it('annual: second year by quarter of joining', () => {
    expect(ent('STATUTORY_ANNUAL', '2025-02-10', 2026)).toBe(14);
    expect(ent('STATUTORY_ANNUAL', '2025-05-10', 2026)).toBe(10);
    expect(ent('STATUTORY_ANNUAL', '2025-08-10', 2026)).toBe(7);
    expect(ent('STATUTORY_ANNUAL', '2025-11-10', 2026)).toBe(4);
  });
  it('annual: 14 from the third year', () => {
    expect(ent('STATUTORY_ANNUAL', '2024-11-10', 2026)).toBe(14);
  });
  it('casual: 1 day per 2 completed months in the joining year', () => {
    expect(ent('STATUTORY_CASUAL', '2026-03-01', 2026, '2026-08-15')).toBe(2);
    expect(ent('STATUTORY_CASUAL', '2026-01-01', 2026, '2026-12-31')).toBe(5);
    expect(ent('STATUTORY_CASUAL', '2025-06-01', 2026)).toBe(7);
  });
  it('counts only working days', () => {
    const working = (d: string) => isoWeekday(d) <= 5 && d !== '2026-10-06';
    expect(countLeaveDays('2026-10-05', '2026-10-11', null, working)).toBe(4);
    expect(countLeaveDays('2026-10-05', '2026-10-05', 'AM', working)).toBe(0.5);
    expect(() => countLeaveDays('2026-10-05', '2026-10-06', 'AM', working)).toThrow();
  });
  it('available balance', () => {
    expect(available({ entitled: 14, carried: 2, adjusted: -1, taken: 3.5 }, 1)).toBe(10.5);
  });
});

describe('TOTP', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  it('matches the RFC 6238 test vector', () => {
    expect(totpAt(secret, 59_000)).toBe('287082');
    expect(totpAt(secret, 1111111109_000)).toBe('081804');
  });
  it('accepts one step of drift', () => {
    expect(verifyTotp(secret, totpAt(secret, 1_000_000_000_000 - 30_000), 1_000_000_000_000)).toBe(true);
    expect(verifyTotp(secret, '000000', 1_000_000_000_000)).toBe(totpAt(secret, 1_000_000_000_000) === '000000');
  });
});
