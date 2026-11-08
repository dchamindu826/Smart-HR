'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useApi } from '@/lib/hooks';
import { thisPeriod } from '@/lib/format';
import { PayslipView, type SlipCompany, type SlipData, type SlipTemplate } from '@/components/PayslipView';
import { Alert, Async, Button, Card, Check, Chip, Empty, ErrorBox, Field, Input, Modal, PageHeader, Select, Tabs, Textarea, Toggle, useUi } from '@/components/ui';

type TabKey = 'components' | 'template';
type Kind = 'EARNING' | 'DEDUCTION';

/** GET /payroll/components */
interface Component {
  id: string;
  code: string;
  name: string;
  kind: Kind;
  epfApplicable: boolean;
  taxable: boolean;
  fixed: boolean;
  affectedByNoPay: boolean;
  active: boolean;
  sortOrder: number;
  _count: { employees: number };
}

/** GET /payroll/template */
interface Template extends SlipTemplate {
  id: string;
  updatedAt: string;
}

export default function PaySettingsPage() {
  const sp = useSearchParams();
  const [tab, setTab] = useState<TabKey>(sp.get('tab') === 'template' ? 'template' : 'components');
  return (
    <>
      <PageHeader title="Pay components & payslip" sub="The allowances and deductions you use, and how payslips look to employees." crumbs={[{ href: '/payroll', label: 'Payroll' }]} />
      <Tabs<TabKey>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'components', label: 'Pay components' },
          { value: 'template', label: 'Payslip template' },
        ]}
      />
      {tab === 'components' ? <ComponentsTab /> : <TemplateTab />}
    </>
  );
}

// ─── Components ───────────────────────────────────────────────

function yes(v: boolean) {
  return v ? <Chip tone="ok">Yes</Chip> : <span className="faint">No</span>;
}

function ComponentsTab() {
  const { can } = useAuth();
  const { toast } = useUi();
  const { data, error, loading, reload } = useApi<Component[]>('/payroll/components');
  const [edit, setEdit] = useState<Component | 'new' | null>(null);
  const canEdit = can('employee.pay.edit');

  return (
    <Card
      pad={false}
      title="Pay components"
      sub="Basic salary is on each employee. Components are amounts added to it or taken from it."
      actions={
        canEdit ? (
          <Button size="sm" variant="pri" icon="edit" onClick={() => setEdit('new')}>
            Add component
          </Button>
        ) : undefined
      }
    >
      <Async data={data} error={error} loading={loading}>
        {(rows) =>
          rows.length === 0 ? (
            <Empty title="No pay components yet" icon="receipt">
              Add allowances such as travel or attendance allowance, and deductions such as welfare.
            </Empty>
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Type</th>
                    <th>EPF applicable</th>
                    <th>Taxable</th>
                    <th>Amount</th>
                    <th>Cut by no-pay</th>
                    <th>Status</th>
                    <th className="num">Employees</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id} style={c.active ? undefined : { opacity: 0.6 }}>
                      <td className="mono">{c.code}</td>
                      <td>
                        <b>{c.name}</b>
                      </td>
                      <td>{c.kind === 'EARNING' ? <Chip tone="ok">Earning</Chip> : <Chip tone="bad">Deduction</Chip>}</td>
                      <td>{yes(c.epfApplicable)}</td>
                      <td>{yes(c.taxable)}</td>
                      <td>{c.fixed ? 'Fixed monthly' : 'Varies by month'}</td>
                      <td>{yes(c.affectedByNoPay)}</td>
                      <td>{c.active ? <Chip tone="ok">Active</Chip> : <Chip>Inactive</Chip>}</td>
                      <td className="num">{c._count.employees}</td>
                      <td className="right">
                        {canEdit && (
                          <Button size="xs" icon="edit" onClick={() => setEdit(c)}>
                            Edit
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Async>
      <div className="card-b tight small muted">EPF-applicable earnings count for EPF 8%/12% and ETF 3%. Taxable earnings count for APIT. Amounts per person are set on the employee&apos;s pay tab.</div>
      {edit && (
        <ComponentModal
          comp={edit === 'new' ? null : edit}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            toast('Pay component saved.');
            reload();
          }}
        />
      )}
    </Card>
  );
}

function ComponentModal({ comp, onClose, onSaved }: { comp: Component | null; onClose: () => void; onSaved: () => void }) {
  const act = useAction();
  const [code, setCode] = useState(comp?.code ?? '');
  const [name, setName] = useState(comp?.name ?? '');
  const [kind, setKind] = useState<Kind>(comp?.kind ?? 'EARNING');
  const [epf, setEpf] = useState(comp?.epfApplicable ?? false);
  const [taxable, setTaxable] = useState(comp?.taxable ?? true);
  const [fixed, setFixed] = useState(comp?.fixed ?? true);
  const [noPay, setNoPay] = useState(comp?.affectedByNoPay ?? false);
  const [active, setActive] = useState(comp?.active ?? true);
  const [sortOrder, setSortOrder] = useState(String(comp?.sortOrder ?? 0));

  const codeOk = /^[A-Za-z0-9_]{2,12}$/.test(code);
  const valid = codeOk && name.trim().length >= 2 && /^-?\d+$/.test(sortOrder);

  const save = async () => {
    const body = { code: code.toUpperCase(), name: name.trim(), kind, epfApplicable: epf, taxable, fixed, affectedByNoPay: noPay, active, sortOrder: Number(sortOrder) };
    const r = await act.run(() => (comp ? api.patch(`/payroll/components/${comp.id}`, body) : api.post('/payroll/components', body)));
    if (r !== undefined) onSaved();
  };

  return (
    <Modal
      title={comp ? `Edit ${comp.name}` : 'Add pay component'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="pri" busy={act.busy} disabled={!valid} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="stack">
        <ErrorBox error={act.error} />
        {comp && comp._count.employees > 0 && <Alert tone="info">{comp._count.employees} employee(s) use this component. Changes apply from the next calculation; locked months do not change.</Alert>}
        <div className="form-grid">
          <Field label="Code" required hint="2–12 letters, digits or _ — e.g. TRAVEL" error={code && !codeOk ? 'Use 2–12 letters, digits or _' : null}>
            <Input value={code} maxLength={12} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          </Field>
          <Field label="Name on payslip" required>
            <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Type" required>
            <Select
              value={kind}
              onChange={(e) => setKind(e.target.value as Kind)}
              options={[
                { value: 'EARNING', label: 'Earning (adds to pay)' },
                { value: 'DEDUCTION', label: 'Deduction (taken from pay)' },
              ]}
            />
          </Field>
          <Field label="Amount">
            <Select
              value={fixed ? 'fixed' : 'variable'}
              onChange={(e) => setFixed(e.target.value === 'fixed')}
              options={[
                { value: 'fixed', label: 'Fixed every month' },
                { value: 'variable', label: 'Varies — entered per month' },
              ]}
            />
          </Field>
          <Field label="Sort order" hint="Lower numbers show first on the payslip.">
            <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </Field>
          <div className="field wide">
            <div className="stack tight">
              {kind === 'EARNING' && (
                <>
                  <Check checked={epf} onChange={setEpf} label="EPF applicable — counts for EPF and ETF" />
                  <Check checked={taxable} onChange={setTaxable} label="Taxable — counts for APIT" />
                  <Check checked={noPay} onChange={setNoPay} label="Reduced by no-pay days (like basic salary)" />
                </>
              )}
              <Check checked={active} onChange={setActive} label="Active — included in payroll" />
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ─── Template ─────────────────────────────────────────────────

const SAMPLE: SlipData = {
  period: thisPeriod(),
  snapshot: {
    empNo: 'E0042',
    name: 'Nimal Perera',
    nic: '199012345678',
    epfNo: '1042',
    designation: 'Senior Accountant',
    department: 'Finance',
    branch: 'Head office',
    joinDate: '2019-03-01',
    bankName: 'Commercial Bank',
    bankBranchCode: '7056-012',
    accountNo: '8001234567',
  },
  lines: [
    { code: 'BASIC', label: 'Basic salary', kind: 'EARNING', amount: '65000.00', quantity: null },
    { code: 'ALW', label: 'Fixed allowance', kind: 'EARNING', amount: '10000.00', quantity: null },
    { code: 'OT', label: 'Overtime', kind: 'EARNING', amount: '4875.00', quantity: '6.5 h' },
    { code: 'EPF', label: 'EPF 8%', kind: 'DEDUCTION', amount: '6000.00', quantity: null },
    { code: 'LOAN', label: 'Staff loan', kind: 'DEDUCTION', amount: '5000.00', quantity: null },
    { code: 'STAMP', label: 'Stamp duty', kind: 'DEDUCTION', amount: '25.00', quantity: null },
  ],
  gross: '79875.00',
  totalDeductions: '11025.00',
  net: '68850.00',
  epfBase: '75000.00',
  epfEmployer: '9000.00',
  etf: '2250.00',
  workedDays: 22,
  noPayDays: 0,
  otMinutes: 390,
  leave: [
    { name: 'Annual', available: 9, taken: 5 },
    { name: 'Casual', available: 4, taken: 3 },
  ],
};

const TOGGLES: { key: 'showLogo' | 'showAddress' | 'showRegNumbers' | 'showBank' | 'showEmployerContrib' | 'showLeaveBalance' | 'showAttendance'; label: string; hint: string }[] = [
  { key: 'showLogo', label: 'Company logo', hint: 'Upload it in Company & logo.' },
  { key: 'showAddress', label: 'Address, phone and email', hint: 'Under the company name.' },
  { key: 'showRegNumbers', label: 'EPF, ETF and TIN numbers', hint: 'Registration numbers in the header.' },
  { key: 'showBank', label: 'Bank account', hint: 'Bank, branch and the last 4 digits only.' },
  { key: 'showEmployerContrib', label: 'Employer EPF 12% and ETF 3%', hint: 'What the company pays on top.' },
  { key: 'showAttendance', label: 'Attendance', hint: 'Days paid, no-pay days and overtime.' },
  { key: 'showLeaveBalance', label: 'Leave left', hint: 'Balance for each leave type.' },
];

interface TplForm {
  accentColor: string;
  showLogo: boolean;
  showAddress: boolean;
  showRegNumbers: boolean;
  showBank: boolean;
  showEmployerContrib: boolean;
  showLeaveBalance: boolean;
  showAttendance: boolean;
  headerNote: string;
  footerNote: string;
  signatureLabel: string;
}

function toForm(t: Template): TplForm {
  return {
    accentColor: t.accentColor,
    showLogo: t.showLogo,
    showAddress: t.showAddress,
    showRegNumbers: t.showRegNumbers,
    showBank: t.showBank,
    showEmployerContrib: t.showEmployerContrib,
    showLeaveBalance: t.showLeaveBalance,
    showAttendance: t.showAttendance,
    headerNote: t.headerNote ?? '',
    footerNote: t.footerNote ?? '',
    signatureLabel: t.signatureLabel ?? '',
  };
}

function TemplateTab() {
  const { can } = useAuth();
  const { toast } = useUi();
  const act = useAction();
  const { data, error, loading, setData } = useApi<Template>('/payroll/template');
  const company = useApi<SlipCompany>('/settings/company');
  const [f, setF] = useState<TplForm | null>(null);
  const canEdit = can('payslip.template');

  useEffect(() => {
    if (data && !f) setF(toForm(data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const set = <K extends keyof TplForm>(k: K, v: TplForm[K]) => setF((x) => (x ? { ...x, [k]: v } : x));
  const colorOk = !!f && /^#[0-9A-Fa-f]{6}$/.test(f.accentColor);
  const dirty = !!f && !!data && JSON.stringify(f) !== JSON.stringify(toForm(data));

  const save = async () => {
    if (!f) return;
    const r = await act.run(() =>
      api.put<Template>('/payroll/template', {
        ...f,
        headerNote: f.headerNote.trim() || null,
        footerNote: f.footerNote.trim() || null,
        signatureLabel: f.signatureLabel.trim() || null,
      }),
    );
    if (r !== undefined) {
      setData(r);
      setF(toForm(r));
      toast('Payslip template saved.');
    }
  };

  return (
    <Async data={data} error={error} loading={loading}>
      {() =>
        f && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 320px', maxWidth: 440, minWidth: 0 }}>
            <Card
              title="Layout"
              footer={
                canEdit ? (
                  <>
                    {dirty && data && (
                      <Button onClick={() => setF(toForm(data))} disabled={act.busy}>
                        Undo changes
                      </Button>
                    )}
                    <Button variant="pri" busy={act.busy} disabled={!dirty || !colorOk} onClick={save}>
                      Save template
                    </Button>
                  </>
                ) : undefined
              }
            >
              <div className="stack">
                <ErrorBox error={act.error} />
                {!canEdit && <Alert tone="info">You can view the template. Only users allowed to change the payslip template can save it.</Alert>}
                <Field label="Accent colour" hint="Used for the company name, the bands and table headings." error={colorOk ? null : 'Use a colour like #002D70'}>
                  <div className="row tight">
                    <input
                      type="color"
                      value={colorOk ? f.accentColor : '#002D70'}
                      disabled={!canEdit}
                      onChange={(e) => set('accentColor', e.target.value.toUpperCase())}
                      style={{ width: 44, height: 36, padding: 0, border: '1px solid var(--rule-2)', borderRadius: 6, background: 'none', cursor: 'pointer' }}
                      aria-label="Pick accent colour"
                    />
                    <Input value={f.accentColor} disabled={!canEdit} maxLength={7} style={{ width: 120 }} onChange={(e) => set('accentColor', e.target.value)} />
                  </div>
                </Field>
                <div>
                  {TOGGLES.map((t) => (
                    <div className="setting" key={t.key} style={{ padding: '9px 0' }}>
                      <div>
                        <b>{t.label}</b>
                        <p>{t.hint}</p>
                      </div>
                      <Toggle checked={f[t.key]} disabled={!canEdit} onChange={(v) => set(t.key, v)} />
                    </div>
                  ))}
                </div>
                <Field label="Note under the title" hint="Optional, up to 300 characters.">
                  <Textarea value={f.headerNote} maxLength={300} disabled={!canEdit} onChange={(e) => set('headerNote', e.target.value)} />
                </Field>
                <Field label="Footer note" hint="Shown at the bottom. Empty: “This is a computer-generated payslip.”">
                  <Textarea value={f.footerNote} maxLength={300} disabled={!canEdit} onChange={(e) => set('footerNote', e.target.value)} />
                </Field>
                <Field label="Signature line" hint="E.g. “Authorised signatory”. Empty: no signature line.">
                  <Input value={f.signatureLabel} maxLength={60} disabled={!canEdit} onChange={(e) => set('signatureLabel', e.target.value)} />
                </Field>
              </div>
            </Card>
            </div>
            <div className="stack" style={{ flex: '2 1 480px', minWidth: 0 }}>
              <div className="row between">
                <b>Preview</b>
                <span className="small muted">Sample employee and figures; your real company header.</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <PayslipView slip={SAMPLE} company={company.data} template={{ ...f, headerNote: f.headerNote || null, footerNote: f.footerNote || null, signatureLabel: f.signatureLabel || null }} />
              </div>
              {company.data && !company.data.hasLogo && f.showLogo && <p className="small muted">No logo uploaded yet. Add one in Company &amp; logo and it appears here and on the PDF.</p>}
            </div>
          </div>
        )
      }
    </Async>
  );
}
