/**
 * Seed: the first platform admin, the three pricing plans, the APIT table and
 * statutory values. With SEED_DEMO=1 it also creates a demo company to click
 * around in locally.
 *
 *   npm run db:seed
 *   SEED_DEMO=1 npm run db:seed
 */

import '../src/core/env.js';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { DEFAULT_PLANS } from '../src/core/features.js';
import { SYSTEM_DEFAULTS } from '../src/core/settings.js';

const db = new PrismaClient();

// Monthly APIT bands from 1 April 2025 (verify against the Inland Revenue table before a live payroll).
const APIT_2025 = [
  { fromAmount: '0.00', toAmount: '150000.00', ratePct: '0.00' },
  { fromAmount: '150000.00', toAmount: '233333.00', ratePct: '6.00' },
  { fromAmount: '233333.00', toAmount: '275000.00', ratePct: '18.00' },
  { fromAmount: '275000.00', toAmount: '316667.00', ratePct: '24.00' },
  { fromAmount: '316667.00', toAmount: '358333.00', ratePct: '30.00' },
  { fromAmount: '358333.00', toAmount: null, ratePct: '36.00' },
];

async function main() {
  // platform admin
  const email = (process.env.PLATFORM_ADMIN_EMAIL ?? 'admin@lumiai.lk').toLowerCase();
  const password = process.env.PLATFORM_ADMIN_PASSWORD ?? 'ChangeMe!2026';
  const admins = await db.platformAdmin.count();
  if (admins === 0) {
    await db.platformAdmin.create({ data: { email, name: 'Lumi AI Admin', role: 'SUPER_ADMIN', passwordHash: await bcrypt.hash(password, 12) } });
    console.log(`Platform admin created: ${email} / ${password}  (change it after the first login)`);
  }

  // plans
  for (const p of DEFAULT_PLANS) {
    await db.plan.upsert({
      where: { code: p.code },
      create: { code: p.code, name: p.name, description: p.description, priceMonthly: p.priceMonthly, priceYearly: p.priceYearly, maxEmployees: p.maxEmployees, features: p.features, sortOrder: p.sortOrder },
      update: {}, // never overwrite prices an admin has changed
    });
  }
  console.log('Plans ready: ' + DEFAULT_PLANS.map((p) => p.code).join(', '));

  // APIT
  const eff = new Date('2025-04-01T00:00:00Z');
  if ((await db.taxBand.count({ where: { table: 'APIT_MONTHLY', effectiveFrom: eff } })) === 0) {
    await db.taxBand.createMany({ data: APIT_2025.map((b, i) => ({ table: 'APIT_MONTHLY', effectiveFrom: eff, sortOrder: i + 1, ...b })) });
    console.log('APIT table loaded (effective 2025-04-01) — verify before a live payroll.');
  }

  // statutory values
  for (const [key, d] of Object.entries(SYSTEM_DEFAULTS)) {
    await db.systemSetting.upsert({ where: { key }, create: { key, value: d.value as never, note: d.note }, update: {} });
  }

  if (process.env.SEED_DEMO === '1') {
    const exists = await db.tenant.findUnique({ where: { slug: 'demo' } });
    if (!exists) {
      const { createTenantWithDefaults } = await import('../src/modules/platform/bootstrap.js');
      const { createDemoData, DEMO_PASSWORD } = await import('../src/modules/platform/demo.js');
      const plan = await db.plan.findUniqueOrThrow({ where: { code: 'COMPLETE' } });
      const r = await db.$transaction((tx) =>
        createTenantWithDefaults(tx as never, { name: 'Demo Holdings (Pvt) Ltd', slug: 'demo', planId: plan.id, status: 'ACTIVE', isDemo: true, demoDays: 365, owner: { name: 'Demo Owner', email: 'owner@demo.lumiai.lk', password: DEMO_PASSWORD } }),
      );
      await createDemoData(r.tenant.id);
      console.log('\nDemo company "demo" created. Logins (password ' + DEMO_PASSWORD + '):');
      console.log('  owner@demo.lumiai.lk         Owner');
      console.log('  hr.demo@demo.lumiai.lk       Head of HR');
      console.log('  manager.demo@demo.lumiai.lk  Manager (makes the Operations roster)');
      console.log('  payroll.demo@demo.lumiai.lk  Payroll officer');
      console.log('  kamal.demo@demo.lumiai.lk    Employee (mobile app)');
    }
  }
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
