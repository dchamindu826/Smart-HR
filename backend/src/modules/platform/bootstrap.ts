/**
 * Creating a company. A new company gets working defaults (a head office,
 * statutory leave types, standard pay components, a general shift, a payslip
 * template) and NO sample people or data. Only demo accounts get sample data.
 */

import type { Prisma } from '@prisma/client';
import type { Tx } from '../../core/db.js';
import { hashPassword, tempPassword } from '../../core/auth.js';
import { tenantSettingsSchema } from '../../core/settings.js';

export interface NewTenant {
  name: string;
  slug: string;
  planId: string;
  status?: 'TRIAL' | 'ACTIVE';
  trialDays?: number;
  isDemo?: boolean;
  demoDays?: number;
  billingCycle?: 'MONTHLY' | 'YEARLY';
  customPrice?: string | null;
  discountPct?: string | null;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  industry?: string | null;
  owner: { name: string; email: string; phone?: string | null; password?: string };
}

export async function createTenantWithDefaults(tx: Tx, t: NewTenant) {
  const now = Date.now();
  const tenant = await tx.tenant.create({
    data: {
      name: t.name,
      slug: t.slug,
      planId: t.planId,
      status: t.status ?? 'TRIAL',
      trialEndsAt: (t.status ?? 'TRIAL') === 'TRIAL' ? new Date(now + (t.trialDays ?? 14) * 86_400_000) : null,
      isDemo: t.isDemo ?? false,
      demoExpiresAt: t.isDemo ? new Date(now + (t.demoDays ?? 14) * 86_400_000) : null,
      billingCycle: t.billingCycle ?? 'MONTHLY',
      customPrice: t.customPrice ?? null,
      discountPct: t.discountPct ?? null,
      contactName: t.contactName ?? t.owner.name,
      phone: t.phone ?? null,
      email: t.email ?? t.owner.email,
      address: t.address ?? null,
      industry: t.industry ?? null,
      settings: tenantSettingsSchema.parse({}) as Prisma.InputJsonValue,
    },
  });

  await tx.branch.create({ data: { tenantId: tenant.id, code: 'HO', name: 'Head office', radiusM: 150 } });

  await tx.leaveType.createMany({
    data: [
      { tenantId: tenant.id, code: 'ANNUAL', name: 'Annual leave', rule: 'STATUTORY_ANNUAL', daysPerYear: 14, carryForwardMax: 0, noticeDays: 3, color: '#0B6FD4', sortOrder: 1 },
      { tenantId: tenant.id, code: 'CASUAL', name: 'Casual leave', rule: 'STATUTORY_CASUAL', daysPerYear: 7, color: '#0B8A5C', sortOrder: 2 },
      { tenantId: tenant.id, code: 'MEDICAL', name: 'Medical leave', rule: 'FIXED', daysPerYear: 7, requireDocument: true, color: '#A96C08', sortOrder: 3 },
      { tenantId: tenant.id, code: 'MATERNITY', name: 'Maternity leave', rule: 'MATERNITY', daysPerYear: 84, allowHalfDay: false, genderOnly: 'FEMALE', color: '#C810B0', sortOrder: 4 },
      { tenantId: tenant.id, code: 'NOPAY', name: 'No-pay leave', rule: 'NO_PAY', paid: false, daysPerYear: 0, allowNegative: true, color: '#BE3220', sortOrder: 5 },
    ],
  });

  await tx.salaryComponent.createMany({
    data: [
      { tenantId: tenant.id, code: 'BRA', name: 'Budgetary relief allowance', kind: 'EARNING', epfApplicable: true, taxable: true, fixed: true, affectedByNoPay: true, sortOrder: 1 },
      { tenantId: tenant.id, code: 'FIXED', name: 'Fixed allowance', kind: 'EARNING', epfApplicable: true, taxable: true, fixed: true, affectedByNoPay: true, sortOrder: 2 },
      { tenantId: tenant.id, code: 'TRAVEL', name: 'Travelling allowance', kind: 'EARNING', epfApplicable: false, taxable: true, fixed: true, sortOrder: 3 },
      { tenantId: tenant.id, code: 'INCENTIVE', name: 'Attendance incentive', kind: 'EARNING', epfApplicable: false, taxable: true, fixed: false, sortOrder: 4 },
      { tenantId: tenant.id, code: 'WELFARE', name: 'Welfare fund', kind: 'DEDUCTION', epfApplicable: false, taxable: false, fixed: true, sortOrder: 10 },
      { tenantId: tenant.id, code: 'ADVANCE', name: 'Salary advance', kind: 'DEDUCTION', epfApplicable: false, taxable: false, fixed: false, sortOrder: 11 },
    ],
  });

  await tx.shiftPattern.create({
    data: { tenantId: tenant.id, code: 'GEN', name: 'General 08:30–17:30', segments: [{ start: 510, end: 1050 }], totalMinutes: 540, color: '#0B6FD4' },
  });

  await tx.payslipTemplate.create({ data: { tenantId: tenant.id, footerNote: 'This is a computer-generated payslip.' } });

  const password = t.owner.password ?? tempPassword();
  const owner = await tx.user.create({
    data: {
      tenantId: tenant.id,
      name: t.owner.name,
      email: t.owner.email.toLowerCase(),
      phone: t.owner.phone ?? null,
      passwordHash: await hashPassword(password),
      role: 'OWNER',
      mustChangePassword: !t.owner.password,
    },
  });

  return { tenant, owner, ownerPassword: password };
}

/** "ABC Holdings (Pvt) Ltd" → "abc-holdings" */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(pvt\)|\bltd\b|\bplc\b|\bprivate\b|\blimited\b/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30) || 'company';
}
