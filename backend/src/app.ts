import express, { Router, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './core/config.js';
import { db } from './core/db.js';
import { errorHandler } from './core/errors.js';
import { consoleOnly, requireAuth } from './core/auth.js';
import { ctxOf, requireFeature } from './core/context.js';
import type { Feature } from './core/features.js';

import { authRouter, meRouter } from './modules/auth/routes.js';
import { platformRouter } from './modules/platform/routes.js';
import { orgRouter } from './modules/org/routes.js';
import { settingsRouter } from './modules/settings/routes.js';
import { employeesRouter } from './modules/employees/routes.js';
import { holidaysRouter } from './modules/holidays/routes.js';
import { rosterRouter, shiftsRouter } from './modules/roster/routes.js';
import { attendanceRouter, terminalRouter } from './modules/attendance/routes.js';
import { leaveRouter } from './modules/leave/routes.js';
import { overtimeRouter } from './modules/overtime/routes.js';
import { payrollRouter, payslipsRouter } from './modules/payroll/routes.js';
import { gratuityRouter, loansRouter, returnsRouter } from './modules/payextras/routes.js';
import { assetsRouter } from './modules/assets/routes.js';
import { announcementsRouter, messagesRouter, notificationsRouter } from './modules/comms/routes.js';
import { importsRouter } from './modules/imports/routes.js';
import { approvalsRouter, auditRouter, dashboardRouter, reportsRouter } from './modules/insights/routes.js';

const feature = (f: Feature) => (req: Request, _res: Response, next: NextFunction) => {
  try {
    requireFeature(ctxOf(req), f);
    next();
  } catch (e) {
    next(e);
  }
};

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', async (_req, res) => {
    let database = 'ok';
    try {
      await db.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }
    const lastJob = await db.jobRun.findFirst({ where: { job: 'day-close' }, orderBy: { startedAt: 'desc' }, select: { key: true, status: true, finishedAt: true } }).catch(() => null);
    res.status(database === 'ok' ? 200 : 503).json({ ok: database === 'ok', database, time: new Date().toISOString(), lastDayClose: lastJob, version: process.env.npm_package_version ?? '1.0.0' });
  });

  const v1 = Router();

  // public / own-auth
  v1.use('/auth', authRouter);
  v1.use('/platform', platformRouter);
  v1.use('/terminal', terminalRouter);

  // every route below needs a company login
  v1.use('/me', meRouter);
  v1.use(requireAuth);

  // available to employees too (the app)
  v1.use('/attendance', attendanceRouter);
  v1.use('/leave', leaveRouter);
  v1.use('/overtime', overtimeRouter);
  v1.use('/payslips', payslipsRouter);
  v1.use('/roster', rosterRouter);
  v1.use('/announcements', announcementsRouter);
  v1.use('/messages', feature('messaging'), messagesRouter);
  v1.use('/notifications', notificationsRouter);
  v1.use('/assets', assetsRouter);
  v1.use('/holidays', holidaysRouter);

  // console only (HR, managers, payroll)
  v1.use('/dashboard', consoleOnly, dashboardRouter);
  v1.use('/approvals', consoleOnly, approvalsRouter);
  v1.use('/org', consoleOnly, orgRouter);
  v1.use('/settings', consoleOnly, settingsRouter);
  v1.use('/employees', consoleOnly, employeesRouter);
  v1.use('/shifts', consoleOnly, shiftsRouter);
  v1.use('/payroll', consoleOnly, payrollRouter);
  v1.use('/loans', consoleOnly, loansRouter);
  v1.use('/gratuity', consoleOnly, gratuityRouter);
  v1.use('/returns', consoleOnly, returnsRouter);
  v1.use('/imports', consoleOnly, importsRouter);
  v1.use('/reports', consoleOnly, reportsRouter);
  v1.use('/audit', consoleOnly, auditRouter);

  app.use('/api/v1', v1);
  app.use('/api', (_req: Request, res: Response) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such API route.' } }));
  app.use(errorHandler);

  if (!config.COOKIE_SECURE && config.NODE_ENV === 'production') {
    console.warn('COOKIE_SECURE is false in production. Set COOKIE_SECURE=true behind HTTPS.');
  }
  return app;
}
