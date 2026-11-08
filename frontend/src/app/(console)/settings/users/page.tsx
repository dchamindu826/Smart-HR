'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAction, useApi, useDebounced } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { ago, dateTime } from '@/lib/format';
import { EmployeePicker } from '@/components/pickers';
import { Alert, Async, Button, Card, Check, Chip, Empty, ErrorBox, Field, Input, Modal, PageHeader, Select, Toggle, useUi } from '@/components/ui';

type Role = 'OWNER' | 'HR_MANAGER' | 'HR_OFFICER' | 'PAYROLL_OFFICER' | 'MANAGER' | 'EMPLOYEE';

interface UserRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: Role;
  branchScope: string[];
  deptScope: string[];
  active: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  lastSeenAt: string | null;
  lockedUntil: string | null;
  createdAt: string;
  employee: { id: string; empNo: string; firstName: string; lastName: string; designation: string | null } | null;
}
interface RoleOpt {
  value: Role;
  label: string;
}
interface Named {
  id: string;
  name: string;
  active?: boolean;
}

const ROLE_HELP: { role: Role; label: string; text: string }[] = [
  { role: 'OWNER', label: 'Owner', text: 'Everything, including billing and running and approving payroll. There is always at least one active owner.' },
  { role: 'HR_MANAGER', label: 'Head of HR', text: 'All employees, settings, users, leave and attendance. Sees pay but cannot run or approve payroll or see billing.' },
  { role: 'HR_OFFICER', label: 'HR officer (branch)', text: 'Day-to-day HR — employees, attendance, leave, overtime, assets — limited to the branches you tick. No pay figures, no settings.' },
  { role: 'PAYROLL_OFFICER', label: 'Payroll officer', text: 'Pay details, payroll runs, loans, statutory returns and gratuity. Cannot change employees’ personal details.' },
  { role: 'MANAGER', label: 'Manager', text: 'Their own team only (people who report to them): attendance, leave and overtime approvals, team reports.' },
  { role: 'EMPLOYEE', label: 'Employee', text: 'The SmartHR app only: mark in and out, apply for leave, see payslips. No console access.' },
];
const SCOPED: Role[] = ['HR_OFFICER', 'MANAGER'];

function Status({ u }: { u: UserRow }) {
  if (!u.active) return <Chip tone="bad">Disabled</Chip>;
  if (u.lockedUntil && new Date(u.lockedUntil).getTime() > Date.now()) return <Chip tone="bad" title={`Locked until ${dateTime(u.lockedUntil)}`}>Locked</Chip>;
  if (u.mustChangePassword) return <Chip tone="warn">Must change password</Chip>;
  return <Chip tone="ok">Active</Chip>;
}

export default function UsersPage() {
  const { can, me } = useAuth();
  const [role, setRole] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const { data, error, loading, reload } = useApi<UserRow[]>(can('users.manage') ? '/settings/users' : null, { role, q: dq.trim() });
  const roles = useApi<RoleOpt[]>('/settings/roles');
  const branches = useApi<Named[]>('/org/branches', { all: '1' });
  const depts = useApi<Named[]>('/org/departments');
  const [edit, setEdit] = useState<UserRow | 'new' | null>(null);
  const [temp, setTemp] = useState<{ name: string; password: string } | null>(null);
  const act = useAction();
  const { toast, confirm } = useUi();

  const roleLabel = (r: string) => roles.data?.find((x) => x.value === r)?.label ?? ROLE_HELP.find((x) => x.role === r)?.label ?? r;
  const bName = (id: string) => branches.data?.find((b) => b.id === id)?.name ?? 'Unknown branch';
  const dName = (id: string) => depts.data?.find((b) => b.id === id)?.name ?? 'Unknown department';

  if (!can('users.manage')) return <Alert>You do not have permission to manage users.</Alert>;

  const reset = async (u: UserRow) => {
    if ((await confirm({ title: `Reset ${u.name}'s password?`, body: 'They are logged out everywhere and must log in with the new temporary password.', ok: 'Reset password' })) === false) return;
    const r = await act.run(() => api.post<{ tempPassword: string }>(`/settings/users/${u.id}/reset-password`));
    if (r !== undefined) {
      setTemp({ name: u.name, password: r.tempPassword });
      reload();
    }
  };

  return (
    <>
      <PageHeader
        title="Users and roles"
        sub="Who can log in, and what each person can see and do."
        actions={
          <Button variant="pri" icon="key" onClick={() => setEdit('new')}>
            Add user
          </Button>
        }
      />
      <ErrorBox error={act.error} />

      <Card pad={false}>
        <div className="filters">
          <Input className="search" type="search" placeholder="Search name, email or mobile…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" />
          <Select value={role} onChange={(e) => setRole(e.target.value)} placeholder="All roles" options={roles.data ?? []} aria-label="Role" />
        </div>
        <Async data={data} error={error} loading={loading}>
          {(rows) =>
            rows.length === 0 ? (
              <Empty title="No users match" icon="key">
                Try another role or search.
              </Empty>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Login</th>
                      <th>Role</th>
                      <th>Scope</th>
                      <th>Employee</th>
                      <th>Last login</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((u) => {
                      const ownerLocked = u.role === 'OWNER' && me?.user.role !== 'OWNER';
                      return (
                        <tr key={u.id}>
                          <td>
                            <b>{u.name}</b>
                            {u.id === me?.user.id && <span className="tiny faint"> (you)</span>}
                          </td>
                          <td className="small">
                            {u.email && <div>{u.email}</div>}
                            {u.phone && <div className="muted">{u.phone}</div>}
                          </td>
                          <td>
                            <Chip tone={u.role === 'OWNER' ? 'mag' : u.role === 'EMPLOYEE' ? '' : 'info'}>{roleLabel(u.role)}</Chip>
                          </td>
                          <td className="small" style={{ maxWidth: 220 }}>
                            {SCOPED.includes(u.role) && (u.branchScope.length || u.deptScope.length) ? (
                              [...u.branchScope.map(bName), ...u.deptScope.map(dName)].join(', ')
                            ) : u.role === 'HR_OFFICER' ? (
                              <span className="muted">All branches</span>
                            ) : u.role === 'MANAGER' ? (
                              <span className="muted">Own team</span>
                            ) : (
                              <span className="faint">—</span>
                            )}
                          </td>
                          <td className="small">
                            {u.employee ? (
                              <Link href={`/employees/${u.employee.id}`}>
                                {u.employee.firstName} {u.employee.lastName} <span className="muted">({u.employee.empNo})</span>
                              </Link>
                            ) : (
                              <span className="faint">Not linked</span>
                            )}
                          </td>
                          <td className="nowrap small" title={u.lastLoginAt ? dateTime(u.lastLoginAt) : undefined}>
                            {u.lastLoginAt ? ago(u.lastLoginAt) : <span className="faint">Never</span>}
                          </td>
                          <td>
                            <Status u={u} />
                          </td>
                          <td className="nowrap right">
                            {!ownerLocked && (
                              <>
                                <Button size="xs" icon="edit" onClick={() => setEdit(u)}>
                                  Edit
                                </Button>{' '}
                                <Button size="xs" icon="key" busy={act.busy} onClick={() => reset(u)}>
                                  Reset password
                                </Button>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          }
        </Async>
      </Card>

      <Card title="What each role can do" pad={false}>
        <div className="tbl-wrap">
          <table className="tbl">
            <tbody>
              {ROLE_HELP.map((r) => (
                <tr key={r.role}>
                  <td className="nowrap" style={{ width: 200 }}>
                    <b>{roleLabel(r.role)}</b>
                  </td>
                  <td className="muted">{r.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card-b small faint">No role can override a statutory rule — EPF, ETF, APIT and the 12-hour weekly overtime limit apply to everyone.</div>
      </Card>

      {edit && (
        <UserModal
          user={edit === 'new' ? null : edit}
          roles={roles.data ?? []}
          branches={(branches.data ?? []).filter((b) => b.active !== false || (edit !== 'new' && edit.branchScope.includes(b.id)))}
          depts={(depts.data ?? []).filter((d) => d.active !== false || (edit !== 'new' && edit.deptScope.includes(d.id)))}
          onClose={() => setEdit(null)}
          onDone={(t) => {
            setEdit(null);
            reload();
            if (t) setTemp(t);
            else toast('User saved.');
          }}
        />
      )}
      {temp && (
        <Modal title="Temporary password" size="narrow" onClose={() => setTemp(null)} footer={<Button variant="pri" onClick={() => setTemp(null)}>Done</Button>}>
          <div className="stack">
            <p>
              Give <b>{temp.name}</b> this temporary password. It is shown only once; they choose their own password at the first login.
            </p>
            <TempBox value={temp.password} />
          </div>
        </Modal>
      )}
    </>
  );
}

function TempBox({ value }: { value: string }) {
  const { toast } = useUi();
  return (
    <div className="row" style={{ background: 'var(--card-2)', border: '1px dashed var(--rule-2)', borderRadius: 8, padding: '10px 12px' }}>
      <span className="mono grow" style={{ fontSize: 18, fontWeight: 700, letterSpacing: '0.04em' }}>
        {value}
      </span>
      <Button
        size="sm"
        icon="copy"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            toast('Copied.');
          } catch {
            toast('Could not copy. Select the password and copy it.', 'bad');
          }
        }}
      >
        Copy
      </Button>
    </div>
  );
}

function UserModal({
  user,
  roles,
  branches,
  depts,
  onClose,
  onDone,
}: {
  user: UserRow | null;
  roles: RoleOpt[];
  branches: Named[];
  depts: Named[];
  onClose: () => void;
  onDone: (temp?: { name: string; password: string }) => void;
}) {
  const { me, has } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [role, setRole] = useState<Role>(user?.role ?? 'HR_OFFICER');
  const [branchScope, setBranchScope] = useState<string[]>(user?.branchScope ?? []);
  const [deptScope, setDeptScope] = useState<string[]>(user?.deptScope ?? []);
  const [employeeId, setEmployeeId] = useState<string | null>(user?.employee?.id ?? null);
  const [active, setActive] = useState(user?.active ?? true);
  const [sendInvite, setSendInvite] = useState(true);
  const act = useAction();

  const isOwner = me?.user.role === 'OWNER';
  const roleOptions = roles.filter((r) => r.value !== 'OWNER' || isOwner || user?.role === 'OWNER');
  const scoped = SCOPED.includes(role);
  const ok = name.trim().length >= 2 && (email.trim() || phone.trim());
  const flip = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const save = async () => {
    const body: Record<string, unknown> = {
      name: name.trim(),
      email: email.trim() || null,
      phone: phone.trim() || null,
      role,
      branchScope: scoped ? branchScope : [],
      deptScope: scoped ? deptScope : [],
      employeeId: employeeId || null,
    };
    if (user) {
      body.active = active;
      const r = await act.run(() => api.patch(`/settings/users/${user.id}`, body));
      if (r !== undefined) onDone();
    } else {
      body.sendInvite = sendInvite;
      const r = await act.run(() => api.post<{ id: string; tempPassword: string }>('/settings/users', body));
      if (r !== undefined) onDone({ name: name.trim(), password: r.tempPassword });
    }
  };

  return (
    <Modal
      title={user ? `Edit ${user.name}` : 'Add a user'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="pri" busy={act.busy} disabled={!ok} onClick={save}>
            {user ? 'Save' : 'Add user'}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Name" required>
          <Input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Role" required hint={ROLE_HELP.find((r) => r.role === role)?.text}>
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)} options={roleOptions} />
        </Field>
        <Field label="Email" hint="Logs in with email or mobile — at least one.">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Mobile" hint="0771234567">
          <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>

        {scoped && (
          <div className="field wide">
            <span className="lbl">Branches</span>
            <span className="hint" style={{ marginTop: -2 }}>
              {role === 'HR_OFFICER'
                ? 'An HR officer sees only the employees of the branches ticked here. Tick none to cover every branch.'
                : 'Optional. A manager always sees their own team; ticking branches limits it further.'}
            </span>
            {role === 'HR_OFFICER' && !has('multi_branch') && branchScope.length > 0 && <Alert tone="warn">Branch-limited HR officers need the Complete plan.</Alert>}
            <div className="row" style={{ gap: 14 }}>
              {branches.length === 0 && <span className="faint small">No branches yet.</span>}
              {branches.map((b) => (
                <Check key={b.id} checked={branchScope.includes(b.id)} onChange={() => setBranchScope(flip(branchScope, b.id))} label={b.name} />
              ))}
            </div>
          </div>
        )}
        {scoped && depts.length > 0 && (
          <div className="field wide">
            <span className="lbl">Departments</span>
            <span className="hint" style={{ marginTop: -2 }}>
              Optional. Limit to these departments as well.
            </span>
            <div className="row" style={{ gap: 14 }}>
              {depts.map((d) => (
                <Check key={d.id} checked={deptScope.includes(d.id)} onChange={() => setDeptScope(flip(deptScope, d.id))} label={d.name} />
              ))}
            </div>
          </div>
        )}

        <Field label="Linked employee" wide hint="Link the user to their employee record so they can use the app for their own attendance, leave and payslips.">
          <EmployeePicker value={employeeId} onChange={(v) => setEmployeeId(v)} />
        </Field>

        {user ? (
          <div className="field wide">
            <Toggle checked={active} onChange={setActive} label="Login active" />
            {!active && <span className="hint">They are logged out at once and cannot log in until switched back on.</span>}
          </div>
        ) : (
          <div className="field wide">
            <Check checked={sendInvite} onChange={setSendInvite} label="Email the login details" />
            <span className="hint">You will also see the temporary password on the next screen.</span>
          </div>
        )}
        <div className="wide">
          <ErrorBox error={act.error} />
        </div>
      </div>
    </Modal>
  );
}
