import { Router } from 'express';
import { parse, z } from '../../core/validate.js';
import { ctxOf } from '../../core/context.js';
import { upload } from '../../core/files.js';
import { sendXlsx } from '../../lib/xlsx.js';
import { assertCan } from '../../core/permissions.js';
import * as svc from './service.js';

export const importsRouter = Router();
const kind = z.enum(['EMPLOYEES', 'LEAVE_BALANCES']);

importsRouter.get('/template/:kind', async (req, res) => {
  assertCan(ctxOf(req), 'import.run');
  const k = parse(kind, req.params.kind);
  sendXlsx(res, `smarthr-${k.toLowerCase()}-template.xlsx`, await svc.template(k));
});
importsRouter.get('/', async (req, res) => res.json(await svc.listJobs(ctxOf(req))));
importsRouter.get('/:id', async (req, res) => res.json(await svc.getJob(ctxOf(req), req.params.id)));
importsRouter.post('/upload/:kind', upload.single('file'), async (req, res) => {
  res.json(await svc.uploadAndValidate(ctxOf(req), parse(kind, req.params.kind), req.file));
});
importsRouter.post('/google-sheet/:kind', async (req, res) => {
  const b = parse(z.object({ url: z.string().url() }), req.body);
  res.json(await svc.fromGoogleSheet(ctxOf(req), parse(kind, req.params.kind), b.url));
});
importsRouter.post('/:id/commit', async (req, res) => {
  const b = parse(z.object({ createLogins: z.boolean().optional() }), req.body ?? {});
  res.json(await svc.commit(ctxOf(req), req.params.id, b));
});
