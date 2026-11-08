/**
 * A calculated or approved payroll must never be locked with figures that are
 * out of date. Any change that affects pay (adjustments, overtime decisions,
 * attendance or leave changes) moves the affected open runs back to DRAFT so
 * they must be recalculated. Locked runs are never touched.
 */

import { db } from '../../core/db.js';
import { dbDate } from '../../lib/time.js';

/** Runs that could include something dated `date` (its own month, and later open runs that pay arrears). */
export async function invalidateRuns(tenantId: string, date: string, why: string) {
  const runs = await db.payrollRun.findMany({
    where: { tenantId, status: { in: ['CALCULATED', 'APPROVED'] }, periodEnd: { gte: dbDate(date) } },
    select: { id: true, status: true, period: true },
  });
  for (const r of runs) {
    await db.payrollRun.update({ where: { id: r.id }, data: { status: 'DRAFT', approvedById: null, approvedAt: null } });
    await db.auditLog.create({
      data: { tenantId, actorId: 'system', actorName: 'System', action: 'payroll.invalidated', entity: 'PayrollRun', entityId: r.id, before: { status: r.status }, after: { status: 'DRAFT', reason: why } },
    });
  }
  return runs.length;
}
