import { Router } from 'express';
import { parse, z, optionalText, email, phone } from '../../core/validate.js';
import { ctxOf } from '../../core/context.js';
import { upload, streamFile } from '../../core/files.js';
import { tenantSettingsSchema } from '../../core/settings.js';
import { ROLE_LABELS } from '../../core/permissions.js';
import * as svc from './service.js';

export const settingsRouter = Router();

settingsRouter.get('/company', async (req, res) => res.json(await svc.getProfile(ctxOf(req))));
settingsRouter.patch('/company', async (req, res) => {
  const t = (n = 200) => optionalText(n);
  const b = parse(
    z.object({
      name: z.string().trim().min(2).max(120).optional(),
      legalName: t(), regNo: t(40), epfRegNo: t(40), etfRegNo: t(40), tinNo: t(40), vatNo: t(40),
      address: t(300), phone: t(30), email: t(120), website: t(120), industry: t(60), contactName: t(100),
    }),
    req.body,
  );
  res.json(await svc.updateProfile(ctxOf(req), b as svc.ProfileInput));
});
settingsRouter.post('/company/logo', upload.single('file'), async (req, res) => res.json(await svc.uploadLogo(ctxOf(req), req.file)));
settingsRouter.get('/company/logo', async (req, res) => {
  const f = await svc.logoFile(ctxOf(req).tenantId);
  streamFile(res, f.path, f.mimeType);
});

settingsRouter.get('/', async (req, res) => res.json(await svc.getSettings(ctxOf(req))));
settingsRouter.patch('/', async (req, res) => res.json(await svc.updateSettings(ctxOf(req), parse(tenantSettingsSchema.partial(), req.body))));

const roleEnum = z.enum(['OWNER', 'HR_MANAGER', 'HR_OFFICER', 'PAYROLL_OFFICER', 'MANAGER', 'EMPLOYEE']);
settingsRouter.get('/roles', (_req, res) => res.json(Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }))));
settingsRouter.get('/users', async (req, res) => {
  const q = parse(z.object({ role: roleEnum.optional(), q: z.string().optional(), active: z.enum(['true', 'false']).optional() }), req.query);
  res.json(await svc.listUsers(ctxOf(req), { ...q, active: q.active === undefined ? undefined : q.active === 'true' }));
});
const userBody = z.object({
  name: z.string().trim().min(2).max(100),
  email: email.nullable().optional(),
  phone: phone.nullable().optional(),
  role: roleEnum,
  branchScope: z.array(z.string()).max(100).optional(),
  deptScope: z.array(z.string()).max(100).optional(),
  employeeId: z.string().nullable().optional(),
});
settingsRouter.post('/users', async (req, res) => {
  const b = parse(userBody.extend({ sendInvite: z.boolean().default(true) }), req.body);
  res.status(201).json(await svc.createUser(ctxOf(req), b, b.sendInvite));
});
settingsRouter.patch('/users/:id', async (req, res) => res.json(await svc.updateUser(ctxOf(req), req.params.id, parse(userBody.partial().extend({ active: z.boolean().optional() }), req.body))));
settingsRouter.post('/users/:id/reset-password', async (req, res) => res.json(await svc.resetUserPassword(ctxOf(req), req.params.id)));

settingsRouter.post('/clear-sample-data', async (req, res) => res.json(await svc.clearSample(ctxOf(req))));
