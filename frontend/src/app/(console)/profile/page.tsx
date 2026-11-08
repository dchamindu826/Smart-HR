'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { Alert, Avatar, Card, Chip, LinkButton, PageHeader } from '@/components/ui';

export default function MyProfilePage() {
  const { me, can } = useAuth();
  if (!me) return null;
  const u = me.user;
  const e = u.employee;

  return (
    <>
      <PageHeader title="My profile" sub="Your login and the company you work in." />
      {u.mustChangePassword && (
        <div style={{ marginBottom: 14 }}>
          <Alert tone="warn">
            You are using a temporary password. <Link href="/change-password">Choose your own password</Link>.
          </Alert>
        </div>
      )}
      <div className="grid2">
        <div>
          <Card title="Login">
            <div className="row" style={{ marginBottom: 14 }}>
              <Avatar name={u.name} photoEmployeeId={e?.id ?? null} size="lg" />
              <div>
                <h2 style={{ fontSize: 19 }}>{u.name}</h2>
                <Chip tone="info">{u.roleLabel}</Chip>
              </div>
            </div>
            <dl className="kv">
              <dt>Email</dt>
              <dd>{u.email ?? <span className="faint">—</span>}</dd>
              <dt>Mobile</dt>
              <dd>{u.phone ?? <span className="faint">—</span>}</dd>
              <dt>Role</dt>
              <dd>{u.roleLabel}</dd>
              <dt>Company</dt>
              <dd>
                {me.tenant.name} <span className="muted small">(code {me.tenant.code})</span>
              </dd>
              <dt>Plan</dt>
              <dd>{me.tenant.plan.name}</dd>
            </dl>
          </Card>
          <Card title="Password and appearance">
            <div className="stack tight">
              <div className="row between">
                <span>Change the password you log in with.</span>
                <LinkButton href="/change-password" size="sm" icon="key">
                  Change password
                </LinkButton>
              </div>
              <p className="small muted">
                The console follows your device’s light or dark setting. Use the moon button in the top bar to switch between light, dark and automatic — the choice is kept on this browser only.
              </p>
            </div>
          </Card>
        </div>
        <div>
          <Card title="My employee record">
            {e ? (
              <div className="stack tight">
                <dl className="kv">
                  <dt>Name</dt>
                  <dd>
                    {e.firstName} {e.lastName}
                  </dd>
                  <dt>Employee number</dt>
                  <dd>{e.empNo}</dd>
                  <dt>Designation</dt>
                  <dd>{e.designation ?? <span className="faint">—</span>}</dd>
                  <dt>Branch</dt>
                  <dd>{e.branch?.name ?? <span className="faint">—</span>}</dd>
                  <dt>Department</dt>
                  <dd>{e.department?.name ?? <span className="faint">—</span>}</dd>
                </dl>
                {can('employee.view') && (
                  <div>
                    <LinkButton href={`/employees/${e.id}`} size="sm">
                      Open full profile
                    </LinkButton>
                  </div>
                )}
                <p className="small faint">Attendance, leave and payslips are in the SmartHR app. Ask HR to correct any of these details.</p>
              </div>
            ) : (
              <p className="muted">This login is not linked to an employee record, so it has no attendance, leave or payslips. {can('users.manage') ? <>Link it under <Link href="/settings/users">Users &amp; roles</Link>.</> : 'Ask HR to link it if you need them.'}</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
