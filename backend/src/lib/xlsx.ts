import ExcelJS from 'exceljs';
import type { Response } from 'express';

export interface Col {
  header: string;
  key: string;
  width?: number;
  money?: boolean;
}

/** One-sheet workbook from rows of plain values. */
export async function workbook(sheetName: string, cols: Col[], rows: Record<string, unknown>[], title?: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SmartHR by Lumi AI';
  const ws = wb.addWorksheet(sheetName.slice(0, 31));
  let start = 1;
  if (title) {
    ws.getCell('A1').value = title;
    ws.getCell('A1').font = { bold: true, size: 13 };
    start = 3;
  }
  const header = ws.getRow(start);
  cols.forEach((c, i) => {
    header.getCell(i + 1).value = c.header;
    ws.getColumn(i + 1).width = c.width ?? Math.max(10, c.header.length + 2);
  });
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF002D70' } };
  rows.forEach((r, ri) => {
    const row = ws.getRow(start + 1 + ri);
    cols.forEach((c, ci) => {
      const v = r[c.key];
      const cell = row.getCell(ci + 1);
      if (c.money && v !== null && v !== undefined && v !== '') {
        cell.value = Number(v);
        cell.numFmt = '#,##0.00';
      } else cell.value = v === undefined ? null : (v as ExcelJS.CellValue);
    });
  });
  ws.views = [{ state: 'frozen', ySplit: start }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function sendXlsx(res: Response, filename: string, buf: Buffer) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.\-]/g, '_')}"`);
  res.send(buf);
}

export function sendCsv(res: Response, filename: string, cols: Col[], rows: Record<string, unknown>[]) {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [cols.map((c) => esc(c.header)).join(','), ...rows.map((r) => cols.map((c) => esc(r[c.key])).join(','))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.\-]/g, '_')}"`);
  res.send('﻿' + body);
}

/** Reads the first sheet of an .xlsx or a .csv into rows keyed by header text. */
export async function readSheet(buf: Buffer, filename: string): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  if (filename.toLowerCase().endsWith('.csv')) return parseCsv(buf.toString('utf8').replace(/^﻿/, ''));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return { headers: [], rows: [] };
  let headerRowNo = 1;
  // first row with 2+ non-empty cells is the header
  for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
    const vals = (ws.getRow(r).values as unknown[]).filter((v) => v !== null && v !== undefined && String(v).trim() !== '');
    if (vals.length >= 2) {
      headerRowNo = r;
      break;
    }
  }
  const headerRow = ws.getRow(headerRowNo);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => (headers[col - 1] = cellText(cell.value).trim()));
  const rows: Record<string, string>[] = [];
  for (let r = headerRowNo + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const obj: Record<string, string> = {};
    let any = false;
    headers.forEach((h, i) => {
      if (!h) return;
      const t = cellText(row.getCell(i + 1).value).trim();
      if (t) any = true;
      obj[h] = t;
    });
    if (any) rows.push(obj);
  }
  return { headers: headers.filter(Boolean), rows };
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('text' in v && typeof v.text === 'string') return v.text;
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('richText' in v && Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('hyperlink' in v) return String((v as { text?: string }).text ?? '');
  }
  return String(v);
}

export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const out: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      out.push(row);
      row = [];
      cur = '';
    } else cur += ch;
  }
  if (cur || row.length) {
    row.push(cur);
    out.push(row);
  }
  const nonEmpty = out.filter((r) => r.some((c) => c.trim() !== ''));
  const headers = (nonEmpty[0] ?? []).map((h) => h.trim());
  const rows = nonEmpty.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
  return { headers, rows };
}
