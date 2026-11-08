/** Payslip PDF, laid out from the company's payslip template (logo, details, colours). */

import PDFDocument from 'pdfkit';
import { existsSync } from 'node:fs';
import { db } from '../../core/db.js';
import { absolutePath } from '../../core/files.js';
import { formatLkr, toCents } from '../../lib/money.js';
import type { Ctx } from '../../core/context.js';
import { getPayslip } from './service.js';

type Slip = Awaited<ReturnType<typeof getPayslip>>;

const money = (v: string | null) => formatLkr(toCents(v ?? '0'));

export async function payslipPdf(ctx: Ctx, payslipId: string): Promise<{ buffer: Buffer; filename: string }> {
  const slip = await getPayslip(ctx, payslipId);
  const [tenant, tpl] = await Promise.all([
    db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } }),
    db.payslipTemplate.findUnique({ where: { tenantId: ctx.tenantId } }),
  ]);
  const t = tpl ?? { accentColor: '#002D70', showLogo: true, showAddress: true, showRegNumbers: true, showBank: true, showEmployerContrib: true, showLeaveBalance: true, showAttendance: true, headerNote: null, footerNote: null, signatureLabel: null };
  const x = slip.snapshot as Record<string, string | null>;
  const buffer = await render(slip, x, tenant, t);
  return { buffer, filename: `payslip-${slip.period}-${x.empNo}.pdf` };
}

function render(
  slip: Slip,
  x: Record<string, string | null>,
  tenant: { name: string; legalName: string | null; address: string | null; phone: string | null; email: string | null; epfRegNo: string | null; etfRegNo: string | null; tinNo: string | null; logoPath: string | null },
  t: { accentColor: string; showLogo: boolean; showAddress: boolean; showRegNumbers: boolean; showBank: boolean; showEmployerContrib: boolean; showLeaveBalance: boolean; showAttendance: boolean; headerNote: string | null; footerNote: string | null; signatureLabel: string | null },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Payslip ${slip.period} — ${x.name}`, Author: tenant.name, Creator: 'SmartHR by Lumi AI' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const accent = /^#[0-9A-Fa-f]{6}$/.test(t.accentColor) ? t.accentColor : '#002D70';
    const W = doc.page.width - 80;
    let y = 40;

    // header
    let textX = 40;
    if (t.showLogo && tenant.logoPath) {
      try {
        const p = absolutePath(tenant.logoPath);
        if (existsSync(p) && !p.endsWith('.svg')) {
          doc.image(p, 40, y, { fit: [90, 50] });
          textX = 140;
        }
      } catch {
        /* ignore a bad logo */
      }
    }
    doc.fillColor(accent).font('Helvetica-Bold').fontSize(15).text(tenant.legalName || tenant.name, textX, y, { width: W - (textX - 40) });
    doc.fillColor('#333').font('Helvetica').fontSize(8.5);
    if (t.showAddress && tenant.address) doc.text(tenant.address, textX, doc.y + 2, { width: W - (textX - 40) });
    const contact = [tenant.phone, tenant.email].filter(Boolean).join('  ·  ');
    if (t.showAddress && contact) doc.text(contact, textX, doc.y + 1);
    if (t.showRegNumbers) {
      const regs = [tenant.epfRegNo && `EPF Reg: ${tenant.epfRegNo}`, tenant.etfRegNo && `ETF Reg: ${tenant.etfRegNo}`, tenant.tinNo && `TIN: ${tenant.tinNo}`].filter(Boolean).join('  ·  ');
      if (regs) doc.text(regs, textX, doc.y + 1);
    }
    y = Math.max(doc.y, 95) + 8;
    doc.rect(40, y, W, 26).fill(accent);
    const label = new Date(slip.period + '-01T00:00:00Z').toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(12).text(`PAYSLIP — ${label.toUpperCase()}`, 50, y + 8);
    y += 36;
    if (t.headerNote) {
      doc.fillColor('#555').font('Helvetica-Oblique').fontSize(8.5).text(t.headerNote, 40, y, { width: W });
      y = doc.y + 6;
    }

    // employee block
    const pairs: [string, string | null][] = [
      ['Employee', x.name], ['Emp No', x.empNo], ['Designation', x.designation], ['Department', x.department],
      ['NIC', x.nic], ['EPF No', x.epfNo], ['Branch', x.branch], ['Joined', x.joinDate],
    ];
    doc.font('Helvetica').fontSize(9).fillColor('#222');
    const colW = W / 2;
    pairs.forEach(([k, v], i) => {
      const cx = 40 + (i % 2) * colW;
      const cy = y + Math.floor(i / 2) * 15;
      doc.fillColor('#777').text(k, cx, cy, { width: 80 });
      doc.fillColor('#111').text(v ?? '—', cx + 80, cy, { width: colW - 90 });
    });
    y += Math.ceil(pairs.length / 2) * 15 + 10;

    // earnings / deductions tables
    const earnings = slip.lines.filter((l) => l.kind === 'EARNING');
    const deductions = slip.lines.filter((l) => l.kind === 'DEDUCTION');
    const tableTop = y;
    const drawTable = (title: string, rows: { label: string; amount: string | null; quantity: string | null }[], x0: number, total: string | null) => {
      let ty = tableTop;
      doc.rect(x0, ty, colW - 8, 18).fill('#EEF2F8');
      doc.fillColor(accent).font('Helvetica-Bold').fontSize(9).text(title, x0 + 6, ty + 5);
      doc.text('Rs', x0, ty + 5, { width: colW - 16, align: 'right' });
      ty += 22;
      doc.font('Helvetica').fontSize(9).fillColor('#222');
      for (const r of rows) {
        doc.text(r.label + (r.quantity ? `  (${r.quantity})` : ''), x0 + 6, ty, { width: colW - 110 });
        doc.text(money(r.amount), x0, ty, { width: colW - 16, align: 'right' });
        ty += 14;
      }
      ty += 4;
      doc.moveTo(x0 + 6, ty).lineTo(x0 + colW - 14, ty).strokeColor('#ccc').stroke();
      doc.font('Helvetica-Bold').text(title === 'Earnings' ? 'Gross pay' : 'Total deductions', x0 + 6, ty + 5);
      doc.text(money(total), x0, ty + 5, { width: colW - 16, align: 'right' });
      return ty + 22;
    };
    const yE = drawTable('Earnings', earnings, 40, slip.gross);
    const yD = drawTable('Deductions', deductions, 40 + colW + 8, slip.totalDeductions);
    y = Math.max(yE, yD) + 6;

    // net
    doc.rect(40, y, W, 30).fill(accent);
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(12).text('NET PAY', 52, y + 9);
    doc.text(`Rs ${money(slip.net)}`, 40, y + 9, { width: W - 12, align: 'right' });
    y += 42;

    doc.fillColor('#222').font('Helvetica').fontSize(8.8);
    const info: string[] = [];
    if (t.showEmployerContrib) info.push(`Employer EPF (12%): Rs ${money(slip.epfEmployer)}    ETF (3%): Rs ${money(slip.etf)}    EPF base: Rs ${money(slip.epfBase)}`);
    if (t.showAttendance) info.push(`Days paid: ${slip.workedDays}    No-pay days: ${slip.noPayDays}    Overtime: ${Math.floor(slip.otMinutes / 60)} h ${slip.otMinutes % 60} min`);
    if (t.showBank && x.accountNo) info.push(`Paid to: ${x.bankName ?? ''} ${x.bankBranchCode ? `(${x.bankBranchCode})` : ''}  A/C ••••${String(x.accountNo).slice(-4)}`);
    if (t.showLeaveBalance && slip.leave.length) info.push('Leave left: ' + slip.leave.map((l) => `${l.name} ${l.available}`).join('  ·  '));
    for (const line of info) {
      doc.text(line, 40, y, { width: W });
      y = doc.y + 4;
    }

    if (t.signatureLabel) {
      y += 30;
      doc.moveTo(W - 140, y).lineTo(W + 40, y).strokeColor('#999').stroke();
      doc.fontSize(8.5).fillColor('#555').text(t.signatureLabel, W - 140, y + 4, { width: 180, align: 'center' });
    }
    doc.fontSize(7.5).fillColor('#888').text(t.footerNote || 'This is a computer-generated payslip.', 40, doc.page.height - 60, { width: W, align: 'center' });
    doc.text('SmartHR by Lumi AI', 40, doc.page.height - 48, { width: W, align: 'center' });
    doc.end();
  });
}
