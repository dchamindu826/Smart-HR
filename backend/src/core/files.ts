/**
 * File uploads, stored on the server's disk under UPLOAD_DIR/<tenantId>/<purpose>/.
 * Files are served only through authenticated routes, never as public static files.
 */

import { mkdirSync, existsSync, createReadStream } from 'node:fs';
import { writeFile, unlink } from 'node:fs/promises';
import { join, extname, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import multer from 'multer';
import type { Response } from 'express';
import { config } from './config.js';
import { db } from './db.js';
import { badRequest, notFound } from './errors.js';

export const UPLOAD_ROOT = resolve(config.UPLOAD_DIR);
mkdirSync(UPLOAD_ROOT, { recursive: true });

const ALLOWED: Record<string, string[]> = {
  LOGO: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'],
  PHOTO: ['image/png', 'image/jpeg', 'image/webp'],
  DOCUMENT: ['application/pdf', 'image/png', 'image/jpeg', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ATTACHMENT: ['application/pdf', 'image/png', 'image/jpeg'],
  IMPORT: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'application/vnd.ms-excel',
    'application/octet-stream',
  ],
};

/** Multer in memory; we validate, then write ourselves. */
export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

export async function saveUpload(
  file: Express.Multer.File | undefined,
  purpose: keyof typeof ALLOWED | 'PAYSLIP',
  tenantId: string | null,
  userId: string | null,
) {
  if (!file) throw badRequest('Choose a file to upload.');
  const allowed = ALLOWED[purpose as keyof typeof ALLOWED];
  const ext = extname(file.originalname).toLowerCase();
  if (allowed && !allowed.includes(file.mimetype) && !(purpose === 'IMPORT' && ['.xlsx', '.csv'].includes(ext))) {
    throw badRequest(`This file type (${file.mimetype}) is not allowed here.`);
  }
  if (purpose === 'IMPORT' && !['.xlsx', '.csv'].includes(ext)) throw badRequest('Upload an Excel (.xlsx) or CSV file.');
  return storeBuffer(file.buffer, file.originalname, file.mimetype, purpose, tenantId, userId);
}

export async function storeBuffer(buf: Buffer, originalName: string, mimeType: string, purpose: string, tenantId: string | null, userId: string | null) {
  const dir = join(tenantId ?? '_platform', purpose.toLowerCase());
  mkdirSync(join(UPLOAD_ROOT, dir), { recursive: true });
  const name = `${Date.now().toString(36)}-${randomBytes(6).toString('hex')}${extname(originalName).toLowerCase().slice(0, 8)}`;
  const rel = join(dir, name);
  await writeFile(join(UPLOAD_ROOT, rel), buf);
  return db.storedFile.create({
    data: { tenantId, path: rel, originalName: originalName.slice(0, 200), mimeType, size: buf.length, purpose, createdById: userId },
  });
}

export function absolutePath(rel: string): string {
  const p = resolve(UPLOAD_ROOT, rel);
  if (!p.startsWith(UPLOAD_ROOT + sep)) throw badRequest('Bad path');
  return p;
}

export function streamFile(res: Response, rel: string, mimeType: string, downloadName?: string) {
  const p = absolutePath(rel);
  if (!existsSync(p)) throw notFound('File');
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (downloadName) res.setHeader('Content-Disposition', `attachment; filename="${downloadName.replace(/[^\w.\- ]/g, '_')}"`);
  createReadStream(p).pipe(res);
}

export async function removeFile(rel: string) {
  await unlink(absolutePath(rel)).catch(() => undefined);
}
