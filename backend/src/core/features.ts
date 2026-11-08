/**
 * Feature codes a plan can include. The platform admin edits which codes each
 * plan has. Codes in ALWAYS_ON are never gated: the employee app, statutory
 * returns and gratuity are part of every plan.
 */

export const FEATURES = {
  people: 'Employees, profiles, lifecycle',
  attendance: 'Attendance (app, web)',
  leave: 'Leave',
  payroll: 'Payroll and payslips',
  returns: 'Statutory returns (EPF, ETF, APIT, bank file)',
  gratuity: 'Gratuity liability',
  import: 'Bulk import from Excel',
  announcements: 'Announcements',
  documents: 'Employee documents',
  roster: 'Roster and shift patterns',
  overtime: 'Overtime claims and approval',
  loans: 'Loans and advances',
  assets: 'Assets and equipment',
  messaging: 'Internal messaging',
  reports: 'Reports and exports',
  terminals: 'Fingerprint / face terminals',
  face: 'Face check in the app',
  multi_branch: 'Branch HR officers and multi-branch overview',
} as const;

export type Feature = keyof typeof FEATURES;

export const ALWAYS_ON: Feature[] = ['people', 'attendance', 'leave', 'payroll', 'returns', 'gratuity'];

export const DEFAULT_PLANS: {
  code: string;
  name: string;
  description: string;
  priceMonthly: string;
  priceYearly: string;
  maxEmployees: number;
  features: Feature[];
  sortOrder: number;
}[] = [
  {
    code: 'STARTER',
    name: 'Starter',
    description: 'Up to 25 employees. Attendance, leave, payroll and returns.',
    priceMonthly: '2500.00',
    priceYearly: '25000.00',
    maxEmployees: 25,
    features: [...ALWAYS_ON, 'import', 'announcements', 'documents', 'overtime'],
    sortOrder: 1,
  },
  {
    code: 'GROWTH',
    name: 'Growth',
    description: 'Up to 100 employees. Adds roster, loans, assets, messaging and reports.',
    priceMonthly: '6500.00',
    priceYearly: '65000.00',
    maxEmployees: 100,
    features: [...ALWAYS_ON, 'import', 'announcements', 'documents', 'overtime', 'roster', 'loans', 'assets', 'messaging', 'reports'],
    sortOrder: 2,
  },
  {
    code: 'COMPLETE',
    name: 'Complete',
    description: 'Up to 500 employees. Everything, including terminals, face check and branch HR.',
    priceMonthly: '14000.00',
    priceYearly: '140000.00',
    maxEmployees: 500,
    features: Object.keys(FEATURES) as Feature[],
    sortOrder: 3,
  },
];

export function hasFeature(features: Iterable<string>, f: Feature): boolean {
  if (ALWAYS_ON.includes(f)) return true;
  for (const x of features) if (x === f) return true;
  return false;
}
