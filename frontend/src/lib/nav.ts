/**
 * The sidebar, built from the user's permissions and the company's plan.
 * Never hard-code a menu elsewhere: add an item here with what it needs.
 */

import type { Me } from './auth';

export type Icon =
  | 'home' | 'inbox' | 'megaphone' | 'chat' | 'users' | 'upload' | 'tree' | 'building' | 'box' | 'clock' | 'calendar'
  | 'grid' | 'leaf' | 'plus-clock' | 'sun' | 'money' | 'loan' | 'scale' | 'file' | 'chart' | 'shield' | 'cog' | 'key'
  | 'sliders' | 'receipt' | 'bell' | 'user' | 'layers' | 'cpu' | 'card' | 'flask';

export interface NavItem {
  href: string;
  label: string;
  icon: Icon;
  /** any of these permissions */
  any?: string[];
  feature?: string;
  /** extra rule using the whole profile */
  when?: (me: Me) => boolean;
  badge?: 'approvals' | 'messages';
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    title: 'Today',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: 'home', any: ['dashboard.view'] },
      { href: '/approvals', label: 'Approvals', icon: 'inbox', any: ['leave.approve', 'overtime.approve', 'attendance.correct', 'asset.decide', 'roster.approve'], badge: 'approvals' },
      { href: '/announcements', label: 'Announcements', icon: 'megaphone', feature: 'announcements' },
      { href: '/messages', label: 'Messages', icon: 'chat', feature: 'messaging', badge: 'messages' },
    ],
  },
  {
    title: 'People',
    items: [
      { href: '/employees', label: 'Employees', icon: 'users', any: ['employee.view'] },
      { href: '/import', label: 'Bulk import', icon: 'upload', any: ['import.run'], feature: 'import' },
      { href: '/org-chart', label: 'Org chart', icon: 'tree', any: ['employee.view'] },
      { href: '/branches', label: 'All branches', icon: 'building', any: ['dashboard.view'], when: (m) => ['OWNER', 'HR_MANAGER', 'HR_OFFICER', 'PAYROLL_OFFICER'].includes(m.user.role) },
      { href: '/assets', label: 'Assets & equipment', icon: 'box', any: ['asset.manage'], feature: 'assets' },
    ],
  },
  {
    title: 'Time',
    items: [
      { href: '/attendance', label: 'Attendance', icon: 'clock', any: ['attendance.view'] },
      { href: '/roster', label: 'Roster', icon: 'grid', feature: 'roster', when: (m) => m.makesRoster || m.permissions.includes('roster.groups') || m.permissions.includes('roster.approve') },
      { href: '/shifts', label: 'Shift patterns', icon: 'layers', any: ['shift.edit'], feature: 'roster' },
      { href: '/leave', label: 'Leave', icon: 'leaf', any: ['leave.view'] },
      { href: '/overtime', label: 'Overtime', icon: 'plus-clock', any: ['attendance.view'], feature: 'overtime' },
      { href: '/holidays', label: 'Holiday & pay calendar', icon: 'sun', any: ['holiday.edit', 'attendance.view'] },
    ],
  },
  {
    title: 'Pay',
    items: [
      { href: '/payroll', label: 'Payroll', icon: 'money', any: ['payroll.view'] },
      { href: '/loans', label: 'Loans & advances', icon: 'loan', any: ['loan.manage'], feature: 'loans' },
      { href: '/gratuity', label: 'Gratuity', icon: 'scale', any: ['gratuity.view'] },
      { href: '/returns', label: 'Statutory returns', icon: 'file', any: ['returns.file'] },
    ],
  },
  {
    title: 'Insights',
    items: [
      { href: '/reports', label: 'Reports', icon: 'chart', any: ['reports.view'] },
      { href: '/audit', label: 'Audit log', icon: 'shield', any: ['audit.view'] },
    ],
  },
  {
    title: 'Setup',
    items: [
      { href: '/settings/company', label: 'Company & logo', icon: 'cog', any: ['settings.edit'] },
      { href: '/settings/branches', label: 'Branches & departments', icon: 'building', any: ['org.edit'] },
      { href: '/settings/users', label: 'Users & roles', icon: 'key', any: ['users.manage'] },
      { href: '/settings/rules', label: 'Attendance & pay rules', icon: 'sliders', any: ['settings.edit'] },
      { href: '/settings/leave-types', label: 'Leave types', icon: 'leaf', any: ['leave.policy'] },
      { href: '/settings/pay', label: 'Pay components & payslip', icon: 'receipt', any: ['payslip.template', 'employee.pay.edit'] },
    ],
  },
];

export function navFor(me: Me): NavGroup[] {
  return NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => {
      if (i.feature && !me.tenant.features.includes(i.feature)) return false;
      if (i.any && !i.any.some((a) => me.permissions.includes(a))) {
        // makers of a roster group reach approvals for nothing else; keep the rule simple
        if (!(i.href === '/approvals' && (me.isManager || me.makesRoster))) return false;
      }
      if (i.when && !i.when(me)) return false;
      return true;
    }),
  })).filter((g) => g.items.length > 0);
}

export const ADMIN_NAV: NavGroup[] = [
  {
    title: 'Lumi AI',
    items: [
      { href: '/admin', label: 'Overview & analytics', icon: 'chart' },
      { href: '/admin/tenants', label: 'Companies', icon: 'building' },
      { href: '/admin/demos', label: 'Demo accounts', icon: 'flask' },
      { href: '/admin/plans', label: 'Plans & pricing', icon: 'money' },
      { href: '/admin/terminals', label: 'Terminals', icon: 'cpu' },
      { href: '/admin/invoices', label: 'Invoices', icon: 'receipt' },
    ],
  },
  {
    title: 'Setup',
    items: [
      { href: '/admin/admins', label: 'Admin logins', icon: 'key' },
      { href: '/admin/system', label: 'Statutory & tax', icon: 'scale' },
      { href: '/admin/audit', label: 'Audit', icon: 'shield' },
    ],
  },
];
