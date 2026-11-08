'use client';

/**
 * HTML payslip, laid out like the PDF (backend/src/modules/payroll/pdf.ts).
 * Used by the payslip page and the live template preview in Settings → Pay.
 * Shows figures exactly as the backend sent them; no maths here.
 */

import { useState } from 'react';
import { fileUrl } from '@/lib/api';
import { date, money, periodLabel } from '@/lib/format';

export interface SlipTemplate {
  accentColor: string;
  showLogo: boolean;
  showAddress: boolean;
  showRegNumbers: boolean;
  showBank: boolean;
  showEmployerContrib: boolean;
  showLeaveBalance: boolean;
  showAttendance: boolean;
  headerNote: string | null;
  footerNote: string | null;
  signatureLabel: string | null;
}

export interface SlipCompany {
  name: string;
  legalName: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  epfRegNo: string | null;
  etfRegNo: string | null;
  tinNo: string | null;
  hasLogo: boolean;
}

export interface SlipSnapshot {
  empNo: string;
  name: string;
  nameWithInitials?: string | null;
  nic?: string | null;
  epfNo?: string | null;
  designation?: string | null;
  department?: string | null;
  branch?: string | null;
  joinDate?: string | null;
  bankName?: string | null;
  bankCode?: string | null;
  bankBranchCode?: string | null;
  accountNo?: string | null;
  accountName?: string | null;
}

export interface SlipLine {
  code: string;
  label: string;
  kind: 'EARNING' | 'DEDUCTION';
  amount: string;
  quantity: string | null;
}

export interface SlipData {
  period: string;
  snapshot: SlipSnapshot;
  lines: SlipLine[];
  gross: string;
  totalDeductions: string;
  net: string;
  epfBase: string;
  epfEmployer: string;
  etf: string;
  workedDays: number;
  noPayDays: number;
  otMinutes: number;
  leave: { name: string; available: number; taken: number }[];
}

const DEFAULT_ACCENT = '#002D70';

export function PayslipView({ slip, company, template }: { slip: SlipData; company: SlipCompany | null; template: SlipTemplate }) {
  const [logoFailed, setLogoFailed] = useState(false);
  const accent = /^#[0-9A-Fa-f]{6}$/.test(template.accentColor) ? template.accentColor : DEFAULT_ACCENT;
  const x = slip.snapshot;
  const earnings = slip.lines.filter((l) => l.kind === 'EARNING');
  const deductions = slip.lines.filter((l) => l.kind === 'DEDUCTION');
  const contact = [company?.phone, company?.email].filter(Boolean).join('  ·  ');
  const regs = [company?.epfRegNo && `EPF Reg: ${company.epfRegNo}`, company?.etfRegNo && `ETF Reg: ${company.etfRegNo}`, company?.tinNo && `TIN: ${company.tinNo}`].filter(Boolean).join('  ·  ');
  const showLogo = template.showLogo && company?.hasLogo && !logoFailed;

  const pairs: [string, string | null | undefined][] = [
    ['Employee', x.name],
    ['Emp No', x.empNo],
    ['Designation', x.designation],
    ['Department', x.department],
    ['NIC', x.nic],
    ['EPF No', x.epfNo],
    ['Branch', x.branch],
    ['Joined', x.joinDate ? date(x.joinDate) : null],
  ];

  const info: string[] = [];
  if (template.showEmployerContrib) info.push(`Employer EPF (12%): Rs ${money(slip.epfEmployer)}    ETF (3%): Rs ${money(slip.etf)}    EPF base: Rs ${money(slip.epfBase)}`);
  if (template.showAttendance) info.push(`Days paid: ${slip.workedDays}    No-pay days: ${slip.noPayDays}    Overtime: ${Math.floor(slip.otMinutes / 60)} h ${slip.otMinutes % 60} min`);
  if (template.showBank && x.accountNo) info.push(`Paid to: ${x.bankName ?? ''} ${x.bankBranchCode ? `(${x.bankBranchCode})` : ''}  A/C ••••${String(x.accountNo).slice(-4)}`);
  if (template.showLeaveBalance && slip.leave.length) info.push('Leave left: ' + slip.leave.map((l) => `${l.name} ${l.available}`).join('  ·  '));

  const table = (title: string, rows: SlipLine[], totalLabel: string, total: string) => (
    <div style={{ minWidth: 0 }}>
      <table>
        <thead>
          <tr style={{ background: '#EEF2F8' }}>
            <td style={{ padding: '5px 8px', color: accent, fontWeight: 700 }}>{title}</td>
            <td style={{ padding: '5px 8px', color: accent, fontWeight: 700, textAlign: 'right' }}>Rs</td>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td style={{ padding: '4px 8px', color: '#999' }} colSpan={2}>
                —
              </td>
            </tr>
          )}
          {rows.map((r, i) => (
            <tr key={r.code + i}>
              <td style={{ padding: '4px 8px' }}>
                {r.label}
                {r.quantity ? <span style={{ color: '#777' }}>{`  (${r.quantity})`}</span> : null}
              </td>
              <td style={{ padding: '4px 8px', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{money(r.amount)}</td>
            </tr>
          ))}
          <tr style={{ borderTop: '1px solid #ccc' }}>
            <td style={{ padding: '6px 8px', fontWeight: 700 }}>{totalLabel}</td>
            <td style={{ padding: '6px 8px', fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{money(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="slip">
      <div className="hd">
        {showLogo && <img src={fileUrl('/settings/company/logo')} alt="" style={{ maxWidth: 90, maxHeight: 50, objectFit: 'contain', flex: 'none' }} onError={() => setLogoFailed(true)} />}
        <div style={{ minWidth: 0 }}>
          <div style={{ color: accent, fontWeight: 700, fontSize: 18, lineHeight: 1.2 }}>{company ? company.legalName || company.name : ' '}</div>
          <div style={{ color: '#333', fontSize: 11.5, lineHeight: 1.45, marginTop: 2 }}>
            {template.showAddress && company?.address && <div style={{ whiteSpace: 'pre-line' }}>{company.address}</div>}
            {template.showAddress && contact && <div>{contact}</div>}
            {template.showRegNumbers && regs && <div>{regs}</div>}
          </div>
        </div>
      </div>

      <div className="band" style={{ background: accent }}>PAYSLIP — {periodLabel(slip.period).toUpperCase()}</div>
      {template.headerNote && <p style={{ color: '#555', fontStyle: 'italic', fontSize: 11.5, margin: '-4px 0 10px' }}>{template.headerNote}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '4px 20px', marginBottom: 14 }}>
        {pairs.map(([k, v]) => (
          <div key={k} style={{ display: 'grid', gridTemplateColumns: '90px minmax(0, 1fr)', gap: 8, fontSize: 12.5 }}>
            <span style={{ color: '#777' }}>{k}</span>
            <span style={{ color: '#111', overflowWrap: 'anywhere' }}>{v || '—'}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, alignItems: 'start' }}>
        {table('Earnings', earnings, 'Gross pay', slip.gross)}
        {table('Deductions', deductions, 'Total deductions', slip.totalDeductions)}
      </div>

      <div className="net" style={{ background: accent }}>
        <span>NET PAY</span>
        <span>Rs {money(slip.net)}</span>
      </div>

      {info.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 12, color: '#222', display: 'grid', gap: 4 }}>
          {info.map((l) => (
            <div key={l} style={{ whiteSpace: 'pre-wrap' }}>
              {l}
            </div>
          ))}
        </div>
      )}

      {template.signatureLabel && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 40 }}>
          <div style={{ width: 180, borderTop: '1px solid #999', paddingTop: 4, textAlign: 'center', fontSize: 11.5, color: '#555' }}>{template.signatureLabel}</div>
        </div>
      )}

      <div style={{ marginTop: 28, textAlign: 'center', fontSize: 10.5, color: '#888' }}>
        <div>{template.footerNote || 'This is a computer-generated payslip.'}</div>
        <div>SmartHR by Lumi AI</div>
      </div>
    </div>
  );
}
