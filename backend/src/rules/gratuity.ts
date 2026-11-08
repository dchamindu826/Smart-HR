/**
 * Gratuity — Payment of Gratuity Act No. 12 of 1983 (verify before use).
 * Payable after 5 completed years: half a month's last-drawn salary for each
 * completed year of service. Applies to employers with 15 or more workers.
 */

import { completedYears } from '../lib/time.js';
import { mulDiv, type Cents } from '../lib/money.js';

export const GRATUITY = {
  minYears: 5,
  monthsPerYearNumerator: 1,
  monthsPerYearDenominator: 2,
  minEmployees: 15,
};

export interface GratuityResult {
  years: number;
  eligible: boolean;
  amount: Cents; // what would be paid if the person left on `asOf`
  liability: Cents; // accrued so far (counted even before 5 years, for the books)
}

export function gratuity(joinDate: string, asOf: string, lastMonthlySalary: Cents): GratuityResult {
  const years = completedYears(joinDate, asOf);
  const liability = mulDiv(lastMonthlySalary, years * GRATUITY.monthsPerYearNumerator, GRATUITY.monthsPerYearDenominator);
  const eligible = years >= GRATUITY.minYears;
  return { years, eligible, amount: eligible ? liability : 0, liability };
}
