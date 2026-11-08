'use client';

import { useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api, download, fileUrl } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { ago, date, dateTime, label, money, today } from '@/lib/format';
import { BranchSelect, DepartmentSelect, EmployeePicker } from '@/components/pickers';
import { Alert, Async, Avatar, Button, Card, Check, Chip, Empty, ErrorBox, Field, Input, LinkButton, Modal, PageHeader, Person, Select, StatusChip, Tabs, Textarea, useUi, type Tone } from '@/components/ui';
import { TempPassword } from '../EmployeeForm';

type Lite = { id: string; firstName: string; lastName: string; designation?: string | null };

interface Profile {
  id: string;
  empNo: string;
  title: string | null;
  firstName: string;
  lastName: string;
  nameWithInitials: string | null;
  callingName: string | null;
  nic: string | null;
  dob: string | null;
  gender: string | null;
  maritalStatus: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  photoPath: string | null;
  branchId: string | null;
  branch: { id: string; name: string } | null;
  departmentId: string | null;
  department: { id: string; name: string } | null;
  designation: string | null;
  grade: string | null;
  managerId: string | null;
  manager: Lite | null;
  reports: Lite[];
  employmentType: string;
  status: string;
  joinDate: string;
  confirmDate: string | null;
  endDate: string | null;
  endReason: string | null;
  payType?: string;
  basicSalary?: string | null;
  epfNo?: string | null;
  epfEligible?: boolean;
  otEligible?: boolean;
  bankName?: string | null;
  bankCode?: string | null;
  bankBranchCode?: string | null;
  accountName?: string | null;
  accountNoMasked?: string;
  defaultShiftPattern: { id: string; name: string } | null;
  rosterGroup: { id: string; name: string } | null;
  allowRemote: boolean | null;
  requireLocation: boolean | null;
  requireFace: boolean | null;
  remoteAddress: string | null;
  remoteLat: number | null;
  remoteLng: number | null;
  birthdayOptOut: boolean;
  isSample: boolean;
  user: { id: string; email: string | null; phone: string | null; role: string; active: boolean; lastLoginAt: string | null; mustChangePassword: boolean } | null;
  events: { id: string; kind: string; effective: string; detail: Record<string, unknown> | null; note: string | null; createdAt: string }[];
  assets: { id: string; tag: string; name: string; category: string; assignedAt: string | null }[];
  canSeePay: boolean;
  leaveBalances: { leaveType: { code: string; name: string; color: string }; entitled: number; carried: number; adjusted: number; taken: number; available: number }[];
  components: { id: string; componentId: string; code: string; name: string; kind: 'EARNING' | 'DEDUCTION'; amount: string; effectiveFrom: string }[];
  documents: { id: string; kind: string; title: string; expiresOn: string | null; createdAt: string; file: { originalName: string; mimeType: string; size: number } }[];
}

interface Balance {
  id: string;
  leaveType: { id: string; code: string; name: string; color: string; paid: boolean };
  year: number;
  entitled: number;
  carried: number;
  adjusted: number;
  taken: number;
  pending: number;
  available: number;
}
interface Component {
  id: string;
  code: string;
  name: string;
  kind: 'EARNING' | 'DEDUCTION';
  active: boolean;
  fixed: boolean;
}
interface Named {
  id: string;
  name: string;
}

type TabKey = 'overview' | 'pay' | 'leave' | 'documents' | 'assets' | 'history';

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner',
  HR_MANAGER: 'Head of HR',
  HR_OFFICER: 'HR officer (branch)',
  PAYROLL_OFFICER: 'Payroll officer',
  MANAGER: 'Manager',
  EMPLOYEE: 'Employee',
};

const EVENT_TONE: Record<string, Tone> = {
  JOINED: 'ok', CONFIRMED: 'ok', PROMOTED: 'mag', TRANSFERRED: 'info', SALARY_CHANGED: 'info', DESIGNATION_CHANGED: 'info',
  WARNING: 'warn', RESIGNED: '', TERMINATED: 'bad', RETIRED: '', REHIRED: 'ok', NOTE: '',
};

const name = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`;

function serviceLength(from: string, to: string): string {
  const a = new Date(from.slice(0, 10) + 'T00:00:00Z');
  const b = new Date(to.slice(0, 10) + 'T00:00:00Z');
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months--;
  if (months < 0) return 'starts soon';
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0 && m === 0) return 'less than a month';
  return [y ? `${y} year${y === 1 ? '' : 's'}` : '', m ? `${m} month${m === 1 ? '' : 's'}` : ''].filter(Boolean).join(' ');
}

const yesNo = (v: boolean | null | undefined, company = 'Company setting') => (v === true ? 'Yes' : v === false ? 'No' : company);
const dash = (v: ReactNode) => (v === null || v === undefined || v === '' ? <span className="faint">—</span> : v);

export default function EmployeeProfilePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can, has } = useAuth();
  const { toast, confirm } = useUi();
  const { data, error, loading, reload } = useApi<Profile>(`/employees/${id}`);
  const [tab, setTab] = useState<TabKey>('overview');
  const [modal, setModal] = useState<null | 'event' | 'login' | 'components' | 'document'>(null);
  const [photoV, setPhotoV] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const act = useAction();

  const uploadPhoto = async (file: File | undefined) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      toast('Use a PNG, JPEG or WebP photo.', 'bad');
      return;
    }
    const r = await act.run(() => api.upload(`/employees/${id}/photo`, file));
    if (r !== undefined) {
      toast('Photo updated.');
      setPhotoV(Date.now());
      reload();
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const remove = async (p: Profile) => {
    const ok = await confirm({
      title: `Delete ${name(p)}?`,
      body: 'This removes the employee and their app login for good. It only works for someone with no attendance, leave or payroll history — otherwise record a resignation or termination instead.',
      ok: 'Delete employee',
      danger: true,
    });
    if (ok === false) return;
    const r = await act.run(() => api.del(`/employees/${id}`));
    if (r !== undefined) {
      toast('Employee deleted.');
      router.push('/employees');
    }
  };

  return (
    <Async data={data} error={error} loading={loading}>
      {(p) => {
        const tabs: { value: TabKey; label: string; count?: number }[] = [{ value: 'overview', label: 'Overview' }];
        if (p.canSeePay) tabs.push({ value: 'pay', label: 'Pay' });
        tabs.push({ value: 'leave', label: 'Leave' });
        if (has('documents')) tabs.push({ value: 'documents', label: 'Documents', count: p.documents.length });
        if (has('assets') || p.assets.length) tabs.push({ value: 'assets', label: 'Assets', count: p.assets.length });
        tabs.push({ value: 'history', label: 'History' });
        const canEdit = can('employee.edit');
        const end = p.status === 'ACTIVE' ? today() : (p.endDate ?? today());

        return (
          <>
            <PageHeader
              title={name(p)}
              crumbs={[{ href: '/employees', label: 'Employees' }]}
              actions={
                <>
                  {canEdit && (
                    <LinkButton href={`/employees/${p.id}/edit`} icon="edit">
                      Edit
                    </LinkButton>
                  )}
                  {canEdit && (
                    <Button icon="calendar" onClick={() => setModal('event')}>
                      Life event
                    </Button>
                  )}
                  {can('employee.account') && (
                    <Button icon="key" onClick={() => setModal('login')}>
                      App login
                    </Button>
                  )}
                  {can('employee.delete') && (
                    <Button variant="danger" icon="trash" busy={act.busy} onClick={() => remove(p)}>
                      Delete
                    </Button>
                  )}
                </>
              }
            />
            <ErrorBox error={act.error} />

            <section className="bento" style={{ marginBottom: 0 }}>
            <article className="tile hero w3">
              <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
                <button
                  type="button"
                  onClick={() => canEdit && fileRef.current?.click()}
                  title={canEdit ? 'Change photo' : undefined}
                  style={{ cursor: canEdit ? 'pointer' : 'default', borderRadius: '50%', position: 'relative' }}
                  aria-label={canEdit ? 'Change photo' : 'Photo'}
                  disabled={!canEdit}
                >
                  {photoV ? (
                    <span className="avatar lg">
                      <img src={fileUrl(`/employees/${p.id}/photo`, { v: photoV })} alt="" />
                    </span>
                  ) : (
                    <Avatar name={name(p)} photoEmployeeId={p.photoPath ? p.id : null} size="lg" />
                  )}
                  {canEdit && (
                    <span className="tiny muted" style={{ display: 'block', marginTop: 4 }}>
                      {p.photoPath ? 'Change' : 'Add photo'}
                    </span>
                  )}
                </button>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => uploadPhoto(e.target.files?.[0])} />
                <div className="grow" style={{ minWidth: 220 }}>
                  <div className="row tight">
                    <h2 style={{ fontSize: 19 }}>
                      {p.title ? `${p.title}. ` : ''}
                      {name(p)}
                    </h2>
                    <StatusChip status={p.status} />
                    <Chip tone="info">{label(p.employmentType)}</Chip>
                    {p.isSample && <Chip tone="mag">Sample data</Chip>}
                  </div>
                  <div className="muted" style={{ marginTop: 2 }}>
                    {[p.designation, p.empNo, p.grade ? `Grade ${p.grade}` : null].filter(Boolean).join(' · ')}
                  </div>
                  <div className="row small" style={{ marginTop: 8, gap: 16 }}>
                    <span>
                      <span className="muted">Branch</span> {p.branch?.name ?? '—'}
                    </span>
                    <span>
                      <span className="muted">Department</span> {p.department?.name ?? '—'}
                    </span>
                    <span>
                      <span className="muted">Reports to</span> {p.manager ? <Link href={`/employees/${p.manager.id}`}>{name(p.manager)}</Link> : '—'}
                    </span>
                    <span>
                      <span className="muted">Joined</span> {date(p.joinDate)} ({serviceLength(p.joinDate, end)})
                    </span>
                    {p.status !== 'ACTIVE' && p.endDate && (
                      <span>
                        <span className="muted">Left</span> {date(p.endDate)}
                        {p.endReason ? ` — ${p.endReason}` : ''}
                      </span>
                    )}
                  </div>
                </div>
                <div className="stack tight" style={{ minWidth: 180 }}>
                  {p.phone && (
                    <a href={`tel:${p.phone}`} className="row tight small">
                      {p.phone}
                    </a>
                  )}
                  {p.email && (
                    <a href={`mailto:${p.email}`} className="small" style={{ overflowWrap: 'anywhere' }}>
                      {p.email}
                    </a>
                  )}
                  <span className="small">
                    App login: <LoginState user={p.user} />
                  </span>
                </div>
              </div>
            </article>
            <article className="tile">
              <h2>At a glance</h2>
              <div className="rowkv">
                <span className="muted">Service</span>
                <b>{serviceLength(p.joinDate, end)}</b>
              </div>
              {p.leaveBalances.slice(0, 2).map((b) => (
                <div className="rowkv" key={b.leaveType.code}>
                  <span className="muted">{b.leaveType.name} left</span>
                  <b>{b.available}</b>
                </div>
              ))}
              <div className="rowkv">
                <span className="muted">Direct reports</span>
                <b>{p.reports.length}</b>
              </div>
              <div className="rowkv">
                <span className="muted">Assets held</span>
                <b>{p.assets.length}</b>
              </div>
            </article>
            </section>

            <div style={{ marginTop: 16 }}>
              <Tabs<TabKey> tabs={tabs} value={tabs.some((t) => t.value === tab) ? tab : 'overview'} onChange={setTab} />
            </div>

            {tab === 'overview' && <Overview p={p} />}
            {tab === 'pay' && p.canSeePay && <PayTab p={p} onChange={() => setModal('components')} />}
            {tab === 'leave' && <LeaveTab p={p} />}
            {tab === 'documents' && has('documents') && <DocumentsTab p={p} onUpload={() => setModal('document')} reload={reload} />}
            {tab === 'assets' && <AssetsTab p={p} />}
            {tab === 'history' && <HistoryTab p={p} />}

            {modal === 'event' && (
              <LifeEventModal
                p={p}
                onClose={() => setModal(null)}
                onDone={() => {
                  setModal(null);
                  reload();
                }}
              />
            )}
            {modal === 'login' && <LoginModal p={p} onClose={() => setModal(null)} onDone={reload} />}
            {modal === 'components' && (
              <ComponentsModal
                p={p}
                onClose={() => setModal(null)}
                onDone={() => {
                  setModal(null);
                  reload();
                }}
              />
            )}
            {modal === 'document' && (
              <DocumentModal
                employeeId={p.id}
                onClose={() => setModal(null)}
                onDone={() => {
                  setModal(null);
                  reload();
                }}
              />
            )}
          </>
        );
      }}
    </Async>
  );
}

function LoginState({ user }: { user: Profile['user'] }) {
  if (!user) return <Chip>None</Chip>;
  if (!user.active) return <Chip tone="bad">Disabled</Chip>;
  if (user.mustChangePassword) return <Chip tone="warn">Must change password</Chip>;
  return <Chip tone="ok">Active</Chip>;
}

// ─── Overview ─────────────────────────────────────────────────

function Overview({ p }: { p: Profile }) {
  return (
    <div className="grid2">
      <Card title="Personal">
        <dl className="kv">
          <dt>Full name</dt>
          <dd>{name(p)}</dd>
          <dt>Name with initials</dt>
          <dd>{dash(p.nameWithInitials)}</dd>
          <dt>Calling name</dt>
          <dd>{dash(p.callingName)}</dd>
          <dt>NIC</dt>
          <dd>{dash(p.nic)}</dd>
          <dt>Date of birth</dt>
          <dd>{p.dob ? date(p.dob) : dash(null)}</dd>
          <dt>Gender</dt>
          <dd>{p.gender ? label(p.gender) : dash(null)}</dd>
          <dt>Marital status</dt>
          <dd>{dash(p.maritalStatus)}</dd>
          <dt>Mobile</dt>
          <dd>{dash(p.phone)}</dd>
          <dt>Email</dt>
          <dd>{dash(p.email)}</dd>
          <dt>Address</dt>
          <dd style={{ whiteSpace: 'pre-line' }}>{dash(p.address)}</dd>
          <dt>Emergency contact</dt>
          <dd>{p.emergencyName || p.emergencyPhone ? [p.emergencyName, p.emergencyPhone].filter(Boolean).join(' · ') : dash(null)}</dd>
        </dl>
      </Card>
      <div>
        <Card title="Job">
          <dl className="kv">
            <dt>Employee number</dt>
            <dd>{p.empNo}</dd>
            <dt>Designation</dt>
            <dd>{dash(p.designation)}</dd>
            <dt>Grade</dt>
            <dd>{dash(p.grade)}</dd>
            <dt>Branch</dt>
            <dd>{dash(p.branch?.name)}</dd>
            <dt>Department</dt>
            <dd>{dash(p.department?.name)}</dd>
            <dt>Reports to</dt>
            <dd>{p.manager ? <Link href={`/employees/${p.manager.id}`}>{name(p.manager)}</Link> : dash(null)}</dd>
            <dt>Employment type</dt>
            <dd>{label(p.employmentType)}</dd>
            <dt>Joined</dt>
            <dd>{date(p.joinDate)}</dd>
            <dt>Confirmed</dt>
            <dd>{p.confirmDate ? date(p.confirmDate) : dash(null)}</dd>
          </dl>
        </Card>
        <Card title="Time and attendance">
          <dl className="kv">
            <dt>Default shift</dt>
            <dd>{p.defaultShiftPattern?.name ?? 'Company working day'}</dd>
            <dt>Roster group</dt>
            <dd>{dash(p.rosterGroup?.name)}</dd>
            <dt>Remote work</dt>
            <dd>{yesNo(p.allowRemote)}</dd>
            <dt>Location needed</dt>
            <dd>{yesNo(p.requireLocation)}</dd>
            <dt>Face check</dt>
            <dd>{yesNo(p.requireFace)}</dd>
            {(p.remoteAddress || p.remoteLat !== null) && (
              <>
                <dt>Remote address</dt>
                <dd>
                  {p.remoteAddress ?? ''}
                  {p.remoteLat !== null && p.remoteLng !== null && (
                    <>
                      {' '}
                      <a href={`https://maps.google.com/?q=${p.remoteLat},${p.remoteLng}`} target="_blank" rel="noreferrer">
                        Map
                      </a>
                    </>
                  )}
                </dd>
              </>
            )}
            <dt>Birthday notices</dt>
            <dd>{p.birthdayOptOut ? 'Not announced' : 'Announced'}</dd>
          </dl>
        </Card>
        <Card title="Direct reports" sub={p.reports.length ? String(p.reports.length) : undefined} pad={false}>
          {p.reports.length === 0 ? (
            <div className="card-b muted small">Nobody reports to {p.firstName}.</div>
          ) : (
            p.reports.map((r) => (
              <div className="list-row" key={r.id}>
                <Person name={name(r)} sub={r.designation ?? undefined} href={`/employees/${r.id}`} photoEmployeeId={r.id} />
              </div>
            ))
          )}
        </Card>
      </div>
    </div>
  );
}

// ─── Pay ──────────────────────────────────────────────────────

function PayTab({ p, onChange }: { p: Profile; onChange: () => void }) {
  const { can } = useAuth();
  const earnings = p.components.filter((c) => c.kind === 'EARNING');
  const deductions = p.components.filter((c) => c.kind === 'DEDUCTION');
  return (
    <div className="grid2">
      <div>
      <Card title="Salary and bank">
        <dl className="kv">
          <dt>Pay type</dt>
          <dd>{p.payType === 'DAILY' ? 'Daily wage' : 'Monthly salary'}</dd>
          <dt>{p.payType === 'DAILY' ? 'Daily rate' : 'Basic salary'}</dt>
          <dd>Rs {money(p.basicSalary)}</dd>
          <dt>EPF number</dt>
          <dd>{dash(p.epfNo)}</dd>
          <dt>EPF / ETF</dt>
          <dd>{p.epfEligible ? <Chip tone="ok">Applies</Chip> : <Chip>Not applicable</Chip>}</dd>
          <dt>Overtime</dt>
          <dd>{p.otEligible ? <Chip tone="ok">Paid</Chip> : <Chip>Not paid</Chip>}</dd>
          <dt>Bank</dt>
          <dd>{p.bankName ? `${p.bankName}${p.bankCode ? ` (${p.bankCode}` : ''}${p.bankBranchCode ? ` / ${p.bankBranchCode}` : ''}${p.bankCode ? ')' : ''}` : dash(null)}</dd>
          <dt>Account</dt>
          <dd>{p.accountNoMasked ? <span className="mono">{p.accountNoMasked}</span> : dash(null)}</dd>
          <dt>Account name</dt>
          <dd>{dash(p.accountName)}</dd>
        </dl>
      </Card>
      </div>
      <div>
      <Card
        title="Fixed allowances and deductions"
        pad={false}
        actions={
          can('employee.pay.edit') ? (
            <Button size="sm" icon="edit" onClick={onChange}>
              Change components
            </Button>
          ) : undefined
        }
      >
        {p.components.length === 0 ? (
          <Empty title="No pay components" icon="receipt">
            Basic salary only. Add allowances such as travel or a fixed deduction here.
          </Empty>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Component</th>
                  <th>Since</th>
                  <th className="num">Amount (Rs)</th>
                </tr>
              </thead>
              <tbody>
                {[...earnings, ...deductions].map((c) => (
                  <tr key={c.id}>
                    <td>
                      {c.name} <span className="faint small">{c.code}</span> {c.kind === 'DEDUCTION' && <Chip tone="warn">Deduction</Chip>}
                    </td>
                    <td className="nowrap">{date(c.effectiveFrom)}</td>
                    <td className="num">
                      {c.kind === 'DEDUCTION' ? '−' : ''}
                      {money(c.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      </div>
    </div>
  );
}

function ComponentsModal({ p, onClose, onDone }: { p: Profile; onClose: () => void; onDone: () => void }) {
  const { data, error, loading } = useApi<Component[]>('/payroll/components');
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries(p.components.map((c) => [c.componentId, c.amount])));
  const [from, setFrom] = useState(today().slice(0, 8) + '01');
  const act = useAction();
  const { toast } = useUi();
  const bad = Object.entries(amounts).filter(([, v]) => v.trim() !== '' && !/^\d+(\.\d{1,2})?$/.test(v.replace(/,/g, '').trim()));

  const save = async () => {
    const items = Object.entries(amounts)
      .map(([componentId, v]) => ({ componentId, amount: v.replace(/,/g, '').trim() }))
      .filter((i) => i.amount !== '' && Number(i.amount) > 0);
    const r = await act.run(() => api.put(`/employees/${p.id}/components`, { effectiveFrom: from, items }));
    if (r !== undefined) {
      toast('Pay components saved.');
      onDone();
    }
  };

  return (
    <Modal
      title="Change pay components"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="pri" busy={act.busy} disabled={!from || bad.length > 0} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="stack">
        <p className="muted small">Enter the monthly amount for each component that applies. Leave blank or 0 to remove it. The previous amounts end the day before the date below.</p>
        <Field label="Effective from" required>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Async data={data} error={error} loading={loading}>
          {(list) => {
            const shown = list.filter((c) => c.active || amounts[c.id]);
            return shown.length === 0 ? (
              <Alert tone="info">
                No pay components are set up yet. Add them under <Link href="/settings/pay">Pay components &amp; payslip</Link>.
              </Alert>
            ) : (
              <div className="tbl-wrap" style={{ border: '1px solid var(--rule)', borderRadius: 8 }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Component</th>
                      <th>Kind</th>
                      <th className="num">Amount (Rs)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((c) => (
                      <tr key={c.id}>
                        <td>
                          {c.name} <span className="faint small">{c.code}</span>
                          {!c.fixed && <div className="tiny faint">Entered each payroll run — a fixed amount here is the default.</div>}
                        </td>
                        <td>{c.kind === 'EARNING' ? <Chip tone="ok">Earning</Chip> : <Chip tone="warn">Deduction</Chip>}</td>
                        <td className="num" style={{ width: 160 }}>
                          <Input
                            className="sm right"
                            inputMode="decimal"
                            value={amounts[c.id] ?? ''}
                            placeholder="0.00"
                            onChange={(e) => setAmounts((x) => ({ ...x, [c.id]: e.target.value }))}
                            style={bad.some(([k]) => k === c.id) ? { borderColor: 'var(--bad)' } : undefined}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }}
        </Async>
        {bad.length > 0 && <Alert>Enter amounts like 5000 or 5000.50.</Alert>}
        <ErrorBox error={act.error} />
      </div>
    </Modal>
  );
}

// ─── Leave ────────────────────────────────────────────────────

function LeaveTab({ p }: { p: Profile }) {
  const { can } = useAuth();
  const thisYear = Number(today().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const useLive = can('leave.view') && p.status === 'ACTIVE';
  const { data, error, loading } = useApi<Balance[]>(useLive ? '/leave/balances' : null, { employeeId: p.id, year });
  const rows: { key: string; name: string; color: string; entitled: number; carried: number; adjusted: number; taken: number; pending: number | null; available: number }[] = useLive
    ? (data ?? []).map((b) => ({ key: b.id, name: b.leaveType.name, color: b.leaveType.color, entitled: b.entitled, carried: b.carried, adjusted: b.adjusted, taken: b.taken, pending: b.pending, available: b.available }))
    : p.leaveBalances.map((b) => ({ key: b.leaveType.code, name: b.leaveType.name, color: b.leaveType.color, entitled: b.entitled, carried: b.carried, adjusted: b.adjusted, taken: b.taken, pending: null, available: b.available }));

  return (
    <Card
      title={`Leave balances — ${year}`}
      pad={false}
      actions={
        useLive ? (
          <div className="row tight">
            <Button size="xs" icon="chev-l" onClick={() => setYear(year - 1)} aria-label="Previous year" />
            <Button size="xs" icon="chev-r" disabled={year >= thisYear + 1} onClick={() => setYear(year + 1)} aria-label="Next year" />
            {can('leave.view') && (
              <LinkButton size="sm" href={`/leave?employeeId=${p.id}`}>
                Leave requests
              </LinkButton>
            )}
          </div>
        ) : undefined
      }
    >
      {useLive && error && !data ? (
        <div className="card-b">
          <Alert>{error}</Alert>
        </div>
      ) : useLive && loading && !data ? (
        <div className="loading">
          <span className="spinner" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <Empty title="No leave balances" icon="leaf">
          Balances are made when the leave year starts, or by importing them.
        </Empty>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Leave type</th>
                <th className="num">Entitled</th>
                <th className="num">Carried</th>
                <th className="num">Adjusted</th>
                <th className="num">Taken</th>
                {useLive && <th className="num">Pending</th>}
                <th className="num">Available</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.key}>
                  <td>
                    <span className="dot" style={{ background: b.color, marginRight: 8 }} />
                    {b.name}
                  </td>
                  <td className="num">{b.entitled}</td>
                  <td className="num">{b.carried || '—'}</td>
                  <td className="num">{b.adjusted || '—'}</td>
                  <td className="num">{b.taken}</td>
                  {useLive && <td className="num">{b.pending ? <Chip tone="warn">{b.pending}</Chip> : '—'}</td>}
                  <td className="num">
                    <b className={b.available < 0 ? 'bad-t' : undefined}>{b.available}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ─── Documents ────────────────────────────────────────────────

const DOC_KINDS = [
  { value: 'NIC', label: 'NIC copy' },
  { value: 'CONTRACT', label: 'Contract' },
  { value: 'CERTIFICATE', label: 'Certificate' },
  { value: 'LETTER', label: 'Letter' },
  { value: 'OTHER', label: 'Other' },
];
const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function DocumentsTab({ p, onUpload, reload }: { p: Profile; onUpload: () => void; reload: () => void }) {
  const { can } = useAuth();
  const { toast, confirm } = useUi();
  const act = useAction();
  const canManage = can('documents.manage');
  const soon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

  const del = async (d: Profile['documents'][number]) => {
    if ((await confirm({ title: `Delete "${d.title}"?`, body: 'The file is removed for good.', ok: 'Delete', danger: true })) === false) return;
    const r = await act.run(() => api.del(`/employees/documents/${d.id}`));
    if (r !== undefined) {
      toast('Document deleted.');
      reload();
    }
  };
  const get = async (d: Profile['documents'][number]) => {
    await act.run(() => download(`/employees/documents/${d.id}/file`, undefined, d.file.originalName));
  };

  return (
    <Card
      title="Documents"
      pad={false}
      actions={
        canManage ? (
          <Button size="sm" variant="pri" icon="upload" onClick={onUpload}>
            Upload
          </Button>
        ) : undefined
      }
    >
      <ErrorBox error={act.error} />
      {p.documents.length === 0 ? (
        <Empty title="No documents" icon="file">
          Keep NIC copies, contracts and letters here. PDF, Word or image files up to 10 MB.
        </Empty>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Title</th>
                <th>Kind</th>
                <th>File</th>
                <th>Uploaded</th>
                <th>Expires</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {p.documents.map((d) => {
                const exp = d.expiresOn?.slice(0, 10);
                return (
                  <tr key={d.id}>
                    <td>
                      <b>{d.title}</b>
                    </td>
                    <td>
                      <Chip>{DOC_KINDS.find((k) => k.value === d.kind)?.label ?? label(d.kind)}</Chip>
                    </td>
                    <td className="small muted">
                      {d.file.originalName} · {kb(d.file.size)}
                    </td>
                    <td className="nowrap">{date(d.createdAt)}</td>
                    <td className="nowrap">
                      {exp ? (
                        exp < today() ? (
                          <Chip tone="bad">Expired {date(exp)}</Chip>
                        ) : exp <= soon ? (
                          <Chip tone="warn">{date(exp)}</Chip>
                        ) : (
                          date(exp)
                        )
                      ) : (
                        <span className="faint">—</span>
                      )}
                    </td>
                    <td className="nowrap right">
                      <Button size="xs" icon="download" onClick={() => get(d)}>
                        Download
                      </Button>{' '}
                      {canManage && <Button size="xs" variant="danger" icon="trash" onClick={() => del(d)} aria-label="Delete" />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function DocumentModal({ employeeId, onClose, onDone }: { employeeId: string; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState('CONTRACT');
  const [title, setTitle] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const act = useAction();
  const { toast } = useUi();
  const save = async () => {
    if (!file) return;
    const fields: Record<string, string> = { kind, title: title.trim() };
    if (expiresOn) fields.expiresOn = expiresOn;
    const r = await act.run(() => api.upload(`/employees/${employeeId}/documents`, file, fields));
    if (r !== undefined) {
      toast('Document uploaded.');
      onDone();
    }
  };
  return (
    <Modal
      title="Upload a document"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="pri" busy={act.busy} disabled={!file || title.trim().length < 2} onClick={save}>
            Upload
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Kind" required>
          <Select value={kind} onChange={(e) => setKind(e.target.value)} options={DOC_KINDS} />
        </Field>
        <Field label="Title" required hint="e.g. Employment contract 2026">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
        </Field>
        <Field label="Expires on" hint="Optional. You are reminded 30 days before.">
          <Input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
        </Field>
        <Field label="File" required wide hint="PDF, Word, PNG or JPEG, up to 10 MB.">
          <input
            type="file"
            className="input"
            accept="application/pdf,image/png,image/jpeg,.docx"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, '').slice(0, 120));
            }}
          />
        </Field>
        <div className="wide">
          <ErrorBox error={act.error} />
        </div>
      </div>
    </Modal>
  );
}

// ─── Assets ───────────────────────────────────────────────────

function AssetsTab({ p }: { p: Profile }) {
  const { can, has } = useAuth();
  return (
    <Card title="Assets and equipment" pad={false} actions={can('asset.manage') && has('assets') ? <LinkButton size="sm" href="/assets">All assets</LinkButton> : undefined}>
      {p.assets.length === 0 ? (
        <Empty title="Nothing assigned" icon="box">
          Laptops, phones, SIMs and uniforms given to {p.firstName} show here.
        </Empty>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Tag</th>
                <th>Item</th>
                <th>Category</th>
                <th>Since</th>
              </tr>
            </thead>
            <tbody>
              {p.assets.map((a) => (
                <tr key={a.id}>
                  <td className="mono">{a.tag}</td>
                  <td>{a.name}</td>
                  <td>{label(a.category)}</td>
                  <td className="nowrap">{a.assignedAt ? date(a.assignedAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ─── History ──────────────────────────────────────────────────

function HistoryTab({ p }: { p: Profile }) {
  const branches = useApi<Named[]>('/org/branches', { all: '1' });
  const depts = useApi<Named[]>('/org/departments');
  const bName = (id: unknown) => (typeof id === 'string' ? (branches.data?.find((b) => b.id === id)?.name ?? 'another branch') : '—');
  const dName = (id: unknown) => (typeof id === 'string' ? (depts.data?.find((b) => b.id === id)?.name ?? 'another department') : '—');

  const detail = (e: Profile['events'][number]): ReactNode => {
    const d = e.detail;
    if (!d) return null;
    const parts: string[] = [];
    const fromTo = (x: unknown) => {
      const o = x as { from?: unknown; to?: unknown } | undefined;
      return o && (o.from !== undefined || o.to !== undefined) ? `${o.from ?? '—'} → ${o.to ?? '—'}` : null;
    };
    switch (e.kind) {
      case 'JOINED':
        if (d.designation) parts.push(String(d.designation));
        if (d.branchId) parts.push(bName(d.branchId));
        break;
      case 'PROMOTED': {
        const des = fromTo(d.designation);
        if (des) parts.push(`Designation: ${des}`);
        const sal = d.salary as { from?: string; to?: string } | undefined;
        if (sal && p.canSeePay) parts.push(`Basic: Rs ${money(sal.from)} → Rs ${money(sal.to)}`);
        break;
      }
      case 'SALARY_CHANGED':
        if (p.canSeePay) parts.push(`Basic: Rs ${money(d.from as string)} → Rs ${money(d.to as string)}`);
        break;
      case 'DESIGNATION_CHANGED': {
        const x = fromTo(d);
        if (x) parts.push(x);
        break;
      }
      case 'TRANSFERRED': {
        const f = (d.from ?? {}) as Record<string, unknown>;
        const t = (d.to ?? {}) as Record<string, unknown>;
        if (t.branchId !== undefined && t.branchId !== f.branchId) parts.push(`Branch: ${bName(f.branchId)} → ${bName(t.branchId)}`);
        if (t.departmentId !== undefined && t.departmentId !== f.departmentId) parts.push(`Department: ${dName(f.departmentId)} → ${dName(t.departmentId)}`);
        if (t.managerId !== undefined && t.managerId !== f.managerId) parts.push('Manager changed');
        break;
      }
    }
    return parts.length ? <div className="small muted">{parts.join(' · ')}</div> : null;
  };

  if (p.events.length === 0) return <Card><Empty title="No history yet" icon="calendar" /></Card>;
  return (
    <Card title="History" sub="Newest first" pad={false}>
      {p.events.map((e) => (
        <div className="list-row" key={e.id} style={{ alignItems: 'flex-start' }}>
          <span className={`dot ${EVENT_TONE[e.kind] === 'bad' ? 'bad' : EVENT_TONE[e.kind] === 'warn' ? 'warn' : EVENT_TONE[e.kind] === 'ok' ? 'ok' : 'info'}`} style={{ marginTop: 7 }} />
          <div className="bd">
            <div className="row tight">
              <Chip tone={EVENT_TONE[e.kind] ?? ''}>{label(e.kind)}</Chip>
              <b style={{ display: 'inline' }}>{date(e.effective)}</b>
            </div>
            {detail(e)}
            {e.note && <div style={{ marginTop: 3, whiteSpace: 'pre-line' }}>{e.note}</div>}
          </div>
          <span className="tiny faint nowrap" title={dateTime(e.createdAt)}>
            recorded {ago(e.createdAt)}
          </span>
        </div>
      ))}
    </Card>
  );
}

// ─── Life event ───────────────────────────────────────────────

const KINDS = [
  { value: 'CONFIRMED', label: 'Confirmed (end of probation)' },
  { value: 'PROMOTED', label: 'Promoted' },
  { value: 'TRANSFERRED', label: 'Transferred' },
  { value: 'WARNING', label: 'Warning' },
  { value: 'RESIGNED', label: 'Resigned' },
  { value: 'TERMINATED', label: 'Terminated' },
  { value: 'RETIRED', label: 'Retired' },
  { value: 'REHIRED', label: 'Rehired' },
  { value: 'NOTE', label: 'Note' },
];

function LifeEventModal({ p, onClose, onDone }: { p: Profile; onClose: () => void; onDone: () => void }) {
  const { can } = useAuth();
  const { toast, confirm } = useUi();
  const active = p.status === 'ACTIVE';
  const kinds = KINDS.filter((k) => (active ? k.value !== 'REHIRED' : ['REHIRED', 'NOTE', 'WARNING'].includes(k.value)));
  const [kind, setKind] = useState(kinds[0].value);
  const [effective, setEffective] = useState(today());
  const [note, setNote] = useState('');
  const [designation, setDesignation] = useState(p.designation ?? '');
  const [grade, setGrade] = useState(p.grade ?? '');
  const [basicSalary, setBasicSalary] = useState('');
  const [branchId, setBranchId] = useState(p.branchId ?? '');
  const [departmentId, setDepartmentId] = useState(p.departmentId ?? '');
  const [managerId, setManagerId] = useState<string | null>(p.managerId);
  const [reason, setReason] = useState('');
  const [employmentType, setEmploymentType] = useState('PROBATION');
  const act = useAction();
  const leaving = ['RESIGNED', 'TERMINATED', 'RETIRED'].includes(kind);
  const salaryBad = basicSalary.trim() !== '' && !/^\d+(\.\d{1,2})?$/.test(basicSalary.replace(/,/g, '').trim());

  const save = async () => {
    if (leaving) {
      const ok = await confirm({
        title: `Record ${label(kind).toLowerCase()}?`,
        body: `${p.firstName} will be marked ${label(kind).toLowerCase()} from ${date(effective)}${effective <= today() ? ' and their app login is switched off now' : '. Their app login is switched off on that day'}.`,
        ok: 'Record',
        danger: true,
      });
      if (ok === false) return;
    }
    const b: Record<string, unknown> = { kind, effective, note: note.trim() || null };
    if (kind === 'PROMOTED') {
      b.designation = designation.trim() || null;
      b.grade = grade.trim() || null;
      if (basicSalary.trim() && can('employee.pay.edit')) b.basicSalary = basicSalary.replace(/,/g, '').trim();
    }
    if (kind === 'TRANSFERRED') {
      b.branchId = branchId || null;
      b.departmentId = departmentId || null;
      b.managerId = managerId || null;
    }
    if (leaving) b.reason = reason.trim() || null;
    if (kind === 'REHIRED') b.employmentType = employmentType;
    const r = await act.run(() => api.post(`/employees/${p.id}/events`, b));
    if (r !== undefined) {
      toast(`${label(kind)} recorded.`);
      onDone();
    }
  };

  return (
    <Modal
      title="Record a life event"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={leaving ? 'danger' : 'pri'} className={leaving ? 'solid' : ''} busy={act.busy} disabled={!effective || salaryBad} onClick={save}>
            Record
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="What happened" required>
          <Select value={kind} onChange={(e) => setKind(e.target.value)} options={kinds} />
        </Field>
        <Field label={leaving ? 'Last working day' : 'Effective date'} required>
          <Input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} />
        </Field>

        {kind === 'CONFIRMED' && (
          <div className="wide">
            <Alert tone="info">The employment type becomes Permanent and the confirmation date is set.</Alert>
          </div>
        )}
        {kind === 'PROMOTED' && (
          <>
            <Field label="New designation">
              <Input value={designation} onChange={(e) => setDesignation(e.target.value)} maxLength={80} />
            </Field>
            <Field label="New grade">
              <Input value={grade} onChange={(e) => setGrade(e.target.value)} maxLength={20} />
            </Field>
            {can('employee.pay.edit') && (
              <Field label="New basic salary (Rs)" hint={p.basicSalary ? `Now Rs ${money(p.basicSalary)}. Leave blank to keep it.` : 'Leave blank to keep it.'} error={salaryBad ? 'Enter an amount like 75000.00.' : null}>
                <Input inputMode="decimal" value={basicSalary} onChange={(e) => setBasicSalary(e.target.value)} placeholder="0.00" />
              </Field>
            )}
          </>
        )}
        {kind === 'TRANSFERRED' && (
          <>
            <Field label="Branch">
              <BranchSelect value={branchId} onChange={setBranchId} placeholder="No branch" />
            </Field>
            <Field label="Department">
              <DepartmentSelect value={departmentId} onChange={setDepartmentId} placeholder="No department" />
            </Field>
            <Field label="Reports to">
              <EmployeePicker value={managerId} onChange={(v) => setManagerId(v)} />
            </Field>
          </>
        )}
        {leaving && (
          <Field label="Reason" wide>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder={kind === 'RESIGNED' ? 'e.g. Moving abroad' : undefined} />
          </Field>
        )}
        {kind === 'REHIRED' && (
          <Field label="Employment type">
            <Select
              value={employmentType}
              onChange={(e) => setEmploymentType(e.target.value)}
              options={['PERMANENT', 'PROBATION', 'CONTRACT', 'TRAINEE', 'CASUAL'].map((v) => ({ value: v, label: label(v) }))}
            />
          </Field>
        )}
        <Field label="Note" wide hint={kind === 'WARNING' ? 'What the warning was for. This stays on the record.' : 'Optional.'}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </Field>
        <div className="wide">
          <ErrorBox error={act.error} />
        </div>
      </div>
    </Modal>
  );
}

// ─── App login ────────────────────────────────────────────────

function LoginModal({ p, onClose, onDone }: { p: Profile; onClose: () => void; onDone: () => void }) {
  const { can } = useAuth();
  const [email, setEmail] = useState(p.email ?? '');
  const [phone, setPhone] = useState(p.phone ?? '');
  const [role, setRole] = useState(p.reports.length > 0 ? 'MANAGER' : 'EMPLOYEE');
  const [sendInvite, setSendInvite] = useState(true);
  const [temp, setTemp] = useState<{ password: string; login: string | null } | null>(null);
  const act = useAction();
  const { toast, confirm } = useUi();

  const roles = ['EMPLOYEE', 'MANAGER', ...(can('users.manage') ? ['HR_OFFICER', 'HR_MANAGER', 'PAYROLL_OFFICER'] : [])].map((v) => ({ value: v, label: ROLE_LABELS[v] }));
  const u = p.user;
  const canReset = !!u && (u.role === 'EMPLOYEE' ? can('employee.account') : can('users.manage')) && u.role !== 'OWNER';

  const create = async () => {
    const r = await act.run(() =>
      api.post<{ userId: string; login: string | null; role: string; tempPassword: string }>(`/employees/${p.id}/account`, {
        email: email.trim() || null,
        phone: phone.trim() || null,
        role,
        sendInvite,
      }),
    );
    if (r !== undefined) {
      setTemp({ password: r.tempPassword, login: r.login });
      toast('App login created.');
      onDone();
    }
  };
  const reset = async () => {
    if (!u) return;
    if ((await confirm({ title: 'Reset password?', body: `${p.firstName} is logged out everywhere and must use the new temporary password.`, ok: 'Reset password' })) === false) return;
    const r = await act.run(() => api.post<{ tempPassword: string }>(`/settings/users/${u.id}/reset-password`));
    if (r !== undefined) {
      setTemp({ password: r.tempPassword, login: u.email ?? u.phone });
      toast('Password reset.');
      onDone();
    }
  };

  return (
    <Modal
      title={u ? 'App login' : 'Create app login'}
      onClose={onClose}
      size="narrow"
      footer={
        temp ? (
          <Button variant="pri" onClick={onClose}>
            Done
          </Button>
        ) : u ? (
          <>
            <Button onClick={onClose}>Close</Button>
            {canReset && (
              <Button variant="pri" icon="key" busy={act.busy} onClick={reset}>
                Reset password
              </Button>
            )}
          </>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="pri" busy={act.busy} disabled={!email.trim() && !phone.trim()} onClick={create}>
              Create login
            </Button>
          </>
        )
      }
    >
      {temp ? (
        <div className="stack">
          <p>
            Give {p.firstName} this temporary password{temp.login ? <> for the login <b>{temp.login}</b></> : null}. It is shown only once; they choose their own password after logging in.
          </p>
          <TempPassword value={temp.password} />
        </div>
      ) : u ? (
        <div className="stack">
          <dl className="kv">
            <dt>Status</dt>
            <dd>
              <LoginState user={u} />
            </dd>
            <dt>Login</dt>
            <dd>{[u.email, u.phone].filter(Boolean).join(' · ') || '—'}</dd>
            <dt>Role</dt>
            <dd>{ROLE_LABELS[u.role] ?? label(u.role)}</dd>
            <dt>Last login</dt>
            <dd>{u.lastLoginAt ? dateTime(u.lastLoginAt) : 'Never'}</dd>
          </dl>
          {!canReset && <p className="small faint">Only someone who manages users can reset this login.</p>}
          {can('users.manage') && (
            <p className="small">
              Change the role or switch the login off under <Link href="/settings/users">Users &amp; roles</Link>.
            </p>
          )}
          <ErrorBox error={act.error} />
        </div>
      ) : p.status !== 'ACTIVE' ? (
        <Alert tone="warn">Only active employees can get an app login.</Alert>
      ) : (
        <div className="stack">
          <p className="muted small">The employee logs in to the SmartHR app with their email or mobile number. Fill in at least one.</p>
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Mobile" hint="0771234567">
            <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="Role" hint={role === 'MANAGER' ? 'Managers approve leave and overtime for their team.' : undefined}>
            <Select value={role} onChange={(e) => setRole(e.target.value)} options={roles} />
          </Field>
          <Check checked={sendInvite} onChange={setSendInvite} label="Email the login details" />
          <ErrorBox error={act.error} />
        </div>
      )}
    </Modal>
  );
}
