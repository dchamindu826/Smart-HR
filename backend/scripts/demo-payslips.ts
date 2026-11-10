/**
 * Sample payslips for a DEMO company (never a real one).
 *   npm run demo:payslips -- <company-slug> [months]
 * e.g. npm run demo:payslips -- demo 2
 */
import { db } from '../src/core/db.js';
import { addDemoPayslips } from '../src/modules/platform/demo.js';

const slug = process.argv[2] ?? 'demo';
const months = Number(process.argv[3] ?? 2);
const t = await db.tenant.findFirst({ where: { slug } });
if (!t) {
  console.error(`No company with slug "${slug}".`);
  process.exit(1);
}
if (!t.isDemo) {
  console.error(`"${slug}" is a real company. Sample payslips are only for demo companies.`);
  process.exit(1);
}
const r = await addDemoPayslips(t.id, months);
console.log(`Released payroll for ${r.periods.join(', ')} in ${t.name}.`);
await db.$disconnect();
