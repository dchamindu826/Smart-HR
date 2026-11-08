'use client';

/**
 * Small helpers shared by the platform admin pages (not a route: no page.tsx here).
 */

import type { ReactNode } from 'react';
import type { PlatformMe } from '@/components/AdminShell';
import { Button, useUi } from '@/components/ui';

export type AdminRole = PlatformMe['role'];

/** SUPER_ADMIN can do everything; otherwise the role must be listed. Mirrors assertRole() in the backend. */
export function roleCan(role: AdminRole, ...roles: AdminRole[]): boolean {
  return role === 'SUPER_ADMIN' || roles.includes(role);
}

export const ROLE_LABEL: Record<AdminRole, string> = {
  SUPER_ADMIN: 'Super admin',
  ADMIN: 'Admin',
  SUPPORT: 'Support',
  SALES: 'Sales',
};

export type TenantStatus = 'TRIAL' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';

export interface PlanRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceMonthly: string;
  priceYearly: string | null;
  maxEmployees: number;
  features: string[];
  active: boolean;
  sortOrder: number;
  tenantCount: number;
}

export interface PlansResp {
  features: Record<string, string>;
  plans: PlanRow[];
}

/** Feature codes every plan includes (backend/src/core/features.ts ALWAYS_ON). */
export const ALWAYS_ON = ['people', 'attendance', 'leave', 'payroll', 'returns', 'gratuity'];

export interface TenantRow {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  isDemo: boolean;
  demoExpiresAt: string | null;
  trialEndsAt: string | null;
  plan: { id: string; code: string; name: string; maxEmployees: number };
  billingCycle: 'MONTHLY' | 'YEARLY';
  customPrice: string | null;
  discountPct: string | null;
  monthlyAmount: string;
  employees: number;
  users: number;
  terminals: number;
  activeUsers7d: number;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  createdAt: string;
}

export interface TenantList {
  total: number;
  rows: TenantRow[];
}

/** Result of POST /platform/tenants and POST /platform/demos. */
export interface CreatedTenant {
  id: string;
  slug: string;
  ownerEmail: string;
  ownerPassword: string;
}

/** ISO instant → Colombo YYYY-MM-DD (for date inputs). */
export function isoToDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Date(t + 330 * 60_000).toISOString().slice(0, 10);
}

/** Whole days from now until an instant (negative when past). */
export function daysLeft(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000);
}

/** "12,500" / "12500.5" → "12500.50"; '' → null. Throws nothing; returns undefined when not a number. */
export function moneyInput(v: string): string | null | undefined {
  const s = v.replace(/,/g, '').trim();
  if (s === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return undefined;
  return Number(s).toFixed(2);
}

/** A read-only value with a copy button. */
export function CopyBox({ label, value, mono = true }: { label?: ReactNode; value: string; mono?: boolean }) {
  const { toast } = useUi();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast('Copied.');
    } catch {
      toast('Could not copy. Select the text and copy it.', 'bad');
    }
  };
  return (
    <div className="field">
      {label && <label>{label}</label>}
      <div className="row tight" style={{ flexWrap: 'nowrap' }}>
        <input className={`input ${mono ? 'mono' : ''}`} readOnly value={value} onFocus={(e) => e.currentTarget.select()} style={{ flex: 1 }} />
        <Button size="sm" icon="copy" onClick={copy}>
          Copy
        </Button>
      </div>
    </div>
  );
}
