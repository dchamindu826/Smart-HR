/**
 * Who may do what. Checked inside services with assertCan(). Scope (which
 * employees) is handled separately in context.ts: a MANAGER only reaches their
 * reports, an HR_OFFICER only their branches, an EMPLOYEE only themselves.
 * No action overrides a statutory rule, for any role.
 */

import type { Role } from '@prisma/client';
import { forbidden } from './errors.js';
import type { Ctx } from './context.js';

export const ACTIONS = [
  'console.access',
  'dashboard.view',
  'employee.view',
  'employee.edit',
  'employee.delete',
  'employee.pay.view',
  'employee.pay.edit',
  'employee.account', // create / reset app logins
  'org.edit', // branches, departments
  'settings.edit',
  'users.manage',
  'billing.view',
  'attendance.view',
  'attendance.correct',
  'shift.edit',
  'roster.groups', // HR decides who makes the roster
  'roster.approve',
  'holiday.edit',
  'leave.view',
  'leave.approve',
  'leave.policy',
  'leave.adjust',
  'overtime.approve',
  'payroll.view',
  'payroll.run',
  'payroll.approve',
  'payslip.template',
  'loan.manage',
  'returns.file',
  'gratuity.view',
  'audit.view',
  'asset.manage',
  'asset.decide',
  'announce.post',
  'import.run',
  'reports.view',
  'documents.manage',
  'sample.clear',
] as const;

export type Action = (typeof ACTIONS)[number];

const ALL = new Set<Action>(ACTIONS);
const except = (...a: Action[]) => new Set<Action>(ACTIONS.filter((x) => !a.includes(x)));

const MATRIX: Record<Role, Set<Action>> = {
  OWNER: ALL,
  HR_MANAGER: except('billing.view', 'payroll.run', 'payroll.approve'),
  HR_OFFICER: new Set<Action>([
    'console.access', 'dashboard.view', 'employee.view', 'employee.edit', 'employee.account',
    'attendance.view', 'attendance.correct', 'leave.view', 'leave.approve', 'overtime.approve',
    'asset.manage', 'asset.decide', 'announce.post', 'import.run', 'reports.view', 'documents.manage',
  ]),
  PAYROLL_OFFICER: new Set<Action>([
    'console.access', 'dashboard.view', 'employee.view', 'employee.pay.view', 'employee.pay.edit',
    'attendance.view', 'leave.view', 'payroll.view', 'payroll.run', 'payroll.approve', 'loan.manage',
    'returns.file', 'gratuity.view', 'reports.view',
  ]),
  MANAGER: new Set<Action>([
    'console.access', 'dashboard.view', 'employee.view', 'attendance.view', 'attendance.correct',
    'leave.view', 'leave.approve', 'overtime.approve', 'reports.view',
  ]),
  EMPLOYEE: new Set<Action>([]),
};

export function can(ctx: Pick<Ctx, 'role' | 'support'>, action: Action): boolean {
  if (ctx.support) {
    // Lumi AI support view: read-only; pay figures only with a payroll reason
    if (!action.endsWith('.view') && action !== 'console.access') return false;
    if ((action === 'employee.pay.view' || action === 'payroll.view') && ctx.support.reasonType !== 'PAYROLL') return false;
    return true;
  }
  return MATRIX[ctx.role].has(action);
}

export function assertCan(ctx: Pick<Ctx, 'role' | 'support'>, action: Action): void {
  if (!can(ctx, action)) throw forbidden();
}

export function actionsFor(ctx: Pick<Ctx, 'role' | 'support'>): Action[] {
  return ACTIONS.filter((a) => can(ctx, a));
}

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'Owner',
  HR_MANAGER: 'Head of HR',
  HR_OFFICER: 'HR officer (branch)',
  PAYROLL_OFFICER: 'Payroll officer',
  MANAGER: 'Manager',
  EMPLOYEE: 'Employee',
};
