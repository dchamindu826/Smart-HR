'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api, download } from '@/lib/api';
import { useAction, useApi, useDebounced } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { date, label } from '@/lib/format';
import { BranchSelect, DepartmentSelect } from '@/components/pickers';
import { Alert, Async, Button, Card, Check, Chip, Empty, ErrorBox, Input, LinkButton, Modal, PageHeader, Pager, Person, Select, StatusChip, Toggle, useUi, type Tone } from '@/components/ui';

interface EmployeeRow {
  id: string;
  empNo: string;
  title: string | null;
  firstName: string;
  lastName: string;
  callingName: string | null;
  designation: string | null;
  grade: string | null;
  status: string;
  employmentType: string;
  joinDate: string;
  endDate: string | null;
  phone: string | null;
  email: string | null;
  nic: string | null;
  photoPath: string | null;
  isSample: boolean;
  branch: { id: string; name: string; code: string } | null;
  department: { id: string; name: string } | null;
  manager: { id: string; firstName: string; lastName: string } | null;
  user: { id: string; role: string; active: boolean; lastLoginAt: string | null; mustChangePassword: boolean } | null;
}
interface EmployeePage {
  rows: EmployeeRow[];
  total: number;
  page: number;
  pageSize: number;
}
interface BulkResult {
  created: { employeeId: string; empNo: string; name: string; login: string; tempPassword: string }[];
  skipped: { employeeId: string; empNo: string; name: string; reason: string }[];
}

const STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'RESIGNED', label: 'Resigned' },
  { value: 'TERMINATED', label: 'Terminated' },
  { value: 'RETIRED', label: 'Retired' },
  { value: 'ALL', label: 'All statuses' },
];
const TYPE_OPTIONS = ['PERMANENT', 'PROBATION', 'CONTRACT', 'TRAINEE', 'CASUAL'].map((v) => ({ value: v, label: label(v) }));
const TYPE_TONE: Record<string, Tone> = { PERMANENT: 'ok', PROBATION: 'info', CONTRACT: 'warn', TRAINEE: 'mag', CASUAL: '' };
const PAGE_SIZE = 50;

function LoginChip({ user }: { user: EmployeeRow['user'] }) {
  if (!user) return <Chip>None</Chip>;
  if (!user.active) return <Chip tone="bad">Disabled</Chip>;
  if (user.mustChangePassword) return <Chip tone="warn">Must change password</Chip>;
  return <Chip tone="ok">Active</Chip>;
}

export default function EmployeesPage() {
  const sp = useSearchParams();
  const { can, has } = useAuth();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [branchId, setBranchId] = useState(sp.get('branchId') ?? '');
  const [departmentId, setDepartmentId] = useState(sp.get('departmentId') ?? '');
  const [status, setStatus] = useState(sp.get('status') ?? 'ACTIVE');
  const [employmentType, setEmploymentType] = useState(sp.get('employmentType') ?? '');
  const [noLogin, setNoLogin] = useState(sp.get('noLogin') === '1');
  const [page, setPage] = useState(1);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { toast } = useUi();
  const dq = useDebounced(q, 300);

  useEffect(() => setPage(1), [dq, branchId, departmentId, status, employmentType, noLogin]);

  const { data, error, loading, reload } = useApi<EmployeePage>('/employees', {
    q: dq,
    branchId,
    departmentId,
    status: noLogin ? undefined : status,
    employmentType,
    noLogin: noLogin ? '1' : undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  const exportXlsx = async () => {
    setExporting(true);
    try {
      await download('/employees/export.xlsx', { status }, 'employees.xlsx');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Export failed.', 'bad');
    } finally {
      setExporting(false);
    }
  };

  const canEdit = can('employee.edit');

  return (
    <>
      <PageHeader
        title="Employees"
        sub="Everyone on the roll. Open a person to see their profile, pay, leave and history."
        actions={
          <>
            <Button icon="download" busy={exporting} onClick={exportXlsx}>
              Export Excel
            </Button>
            {can('employee.account') && (
              <Button icon="key" onClick={() => setBulkOpen(true)}>
                Create app logins
              </Button>
            )}
            {can('import.run') && has('import') && (
              <LinkButton href="/import" icon="upload">
                Bulk import
              </LinkButton>
            )}
            {canEdit && (
              <LinkButton href="/employees/new" variant="pri" icon="users">
                Add employee
              </LinkButton>
            )}
          </>
        }
      />

      <Card pad={false}>
        <div className="filters">
          <Input className="search" type="search" placeholder="Search name, number, NIC, mobile…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search employees" />
          <BranchSelect value={branchId} onChange={setBranchId} />
          <DepartmentSelect value={departmentId} onChange={setDepartmentId} />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} options={STATUS_OPTIONS} disabled={noLogin} aria-label="Status" />
          <Select value={employmentType} onChange={(e) => setEmploymentType(e.target.value)} options={TYPE_OPTIONS} placeholder="All types" aria-label="Employment type" />
          <Toggle checked={noLogin} onChange={setNoLogin} label="Without app login" />
        </div>
        <Async data={data} error={error} loading={loading}>
          {(d) =>
            d.rows.length === 0 ? (
              <Empty
                title={dq || branchId || departmentId || employmentType || noLogin || status !== 'ACTIVE' ? 'No employees match' : 'No employees yet'}
                icon="users"
                action={canEdit && !dq ? <LinkButton href="/employees/new" variant="pri">Add employee</LinkButton> : undefined}
              >
                {dq || branchId || departmentId || employmentType || noLogin ? 'Try clearing a filter or the search.' : 'Add people one by one, or import them all from Excel.'}
              </Empty>
            ) : (
              <>
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Branch</th>
                        <th>Department</th>
                        <th>Type</th>
                        <th>Joined</th>
                        <th>App login</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {d.rows.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <div className="row tight" style={{ flexWrap: 'nowrap', alignItems: 'center' }}>
                              <Person
                                name={`${r.firstName} ${r.lastName}`}
                                sub={[r.empNo, r.designation].filter(Boolean).join(' · ')}
                                href={`/employees/${r.id}`}
                                photoEmployeeId={r.photoPath ? r.id : null}
                              />
                              {r.isSample && (
                                <Chip tone="mag" title="Sample data — removable from Company settings">
                                  Sample
                                </Chip>
                              )}
                              {r.status !== 'ACTIVE' && <StatusChip status={r.status} />}
                            </div>
                          </td>
                          <td>{r.branch?.name ?? <span className="faint">—</span>}</td>
                          <td>{r.department?.name ?? <span className="faint">—</span>}</td>
                          <td>
                            <Chip tone={TYPE_TONE[r.employmentType] ?? ''}>{label(r.employmentType)}</Chip>
                          </td>
                          <td className="nowrap">{date(r.joinDate)}</td>
                          <td>
                            <LoginChip user={r.user} />
                          </td>
                          <td className="nowrap right">
                            <div className="tbl-actions">
                              <Link className="btn xs" href={`/employees/${r.id}`}>
                                Open
                              </Link>
                              {canEdit && (
                                <Link className="btn xs" href={`/employees/${r.id}/edit`}>
                                  Edit
                                </Link>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
                {d.total <= d.pageSize && (
                  <div className="pager">
                    <span>
                      {d.total} employee{d.total === 1 ? '' : 's'}
                    </span>
                  </div>
                )}
              </>
            )
          }
        </Async>
      </Card>

      {bulkOpen && (
        <BulkLoginsModal
          onClose={() => setBulkOpen(false)}
          onDone={() => {
            reload();
          }}
        />
      )}
    </>
  );
}

// ─── bulk app logins ──────────────────────────────────────────

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

function BulkLoginsModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [sendInvite, setSendInvite] = useState(true);
  const [result, setResult] = useState<BulkResult | null>(null);
  const act = useAction();
  const { toast } = useUi();
  const { me } = useAuth();
  const { data: pending } = useApi<EmployeePage>('/employees', { noLogin: '1', pageSize: 1 });

  const run = async () => {
    const r = await act.run(() => api.post<BulkResult>('/employees/accounts/bulk', { sendInvite }));
    if (r !== undefined) {
      setResult(r);
      onDone();
      toast(`${r.created.length} login${r.created.length === 1 ? '' : 's'} created.`);
    }
  };

  const copy = async () => {
    if (!result) return;
    const lines = ['Emp No\tName\tLogin\tTemporary password', ...result.created.map((c) => `${c.empNo}\t${c.name}\t${c.login}\t${c.tempPassword}`)];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast('Copied. Paste into Excel or a message.');
    } catch {
      toast('Could not copy — select the table and copy it by hand.', 'bad');
    }
  };

  const print = () => {
    if (!result) return;
    const w = window.open('', '_blank', 'width=800,height=900');
    if (!w) {
      toast('Allow pop-ups to print the list.', 'bad');
      return;
    }
    const rows = result.created.map((c) => `<tr><td>${esc(c.empNo)}</td><td>${esc(c.name)}</td><td>${esc(c.login)}</td><td class="pw">${esc(c.tempPassword)}</td></tr>`).join('');
    w.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>SmartHR app logins</title><style>body{font-family:system-ui,sans-serif;padding:24px;color:#111}h1{font-size:18px;margin:0 0 4px}p{color:#555;font-size:13px;margin:0 0 16px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}th{background:#f2f2f2}.pw{font-family:ui-monospace,Menlo,monospace;font-size:14px}</style></head><body><h1>SmartHR app logins — ${esc(me?.tenant.name ?? '')}</h1><p>Company code: <b>${esc(me?.tenant.code ?? '')}</b>. Each person logs in with the login below and the temporary password, then chooses their own password.</p><table><thead><tr><th>Emp No</th><th>Name</th><th>Login</th><th>Temporary password</th></tr></thead><tbody>${rows}</tbody></table></body></html>`,
    );
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <Modal
      title="Create app logins"
      onClose={onClose}
      size={result ? 'wide' : undefined}
      footer={
        result ? (
          <>
            {result.created.length > 0 && (
              <>
                <Button icon="copy" onClick={copy}>
                  Copy
                </Button>
                <Button icon="print" onClick={print}>
                  Print
                </Button>
              </>
            )}
            <Button variant="pri" onClick={onClose}>
              Done
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="pri" busy={act.busy} disabled={pending?.total === 0} onClick={run}>
              Create logins
            </Button>
          </>
        )
      }
    >
      {!result ? (
        <div className="stack">
          <p className="muted">
            This creates a SmartHR app login for every <b>active employee who does not have one yet</b>. Each login uses the employee&apos;s email, or their mobile number when there is no email.
            Employees without either are skipped — add a contact to their profile first.
          </p>
          {pending && (
            <Alert tone={pending.total ? 'info' : 'ok'}>
              {pending.total ? `${pending.total} active employee${pending.total === 1 ? '' : 's'} without a login.` : 'Every active employee already has a login.'}
            </Alert>
          )}
          <Check checked={sendInvite} onChange={setSendInvite} label="Email each person their login details (only those with an email address)" />
          <p className="small faint">You will see every temporary password once on the next screen, to print or copy. Employees choose their own password at the first login.</p>
          <ErrorBox error={act.error} />
        </div>
      ) : (
        <div className="stack">
          <Alert tone={result.created.length ? 'ok' : 'warn'}>
            {result.created.length} created · {result.skipped.length} skipped. Note the temporary passwords now — they are not shown again.
          </Alert>
          {result.created.length > 0 && (
            <div className="tbl-wrap" style={{ border: '1px solid var(--rule)', borderRadius: 8 }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Emp No</th>
                    <th>Name</th>
                    <th>Login</th>
                    <th>Temporary password</th>
                  </tr>
                </thead>
                <tbody>
                  {result.created.map((c) => (
                    <tr key={c.employeeId}>
                      <td>{c.empNo}</td>
                      <td>{c.name}</td>
                      <td>{c.login}</td>
                      <td className="mono">
                        <b>{c.tempPassword}</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.skipped.length > 0 && (
            <>
              <b>Skipped</b>
              <div className="tbl-wrap" style={{ border: '1px solid var(--rule)', borderRadius: 8 }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Emp No</th>
                      <th>Name</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.skipped.map((s) => (
                      <tr key={s.employeeId}>
                        <td>{s.empNo}</td>
                        <td>
                          <Link href={`/employees/${s.employeeId}`}>{s.name}</Link>
                        </td>
                        <td className="bad-t">{s.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
