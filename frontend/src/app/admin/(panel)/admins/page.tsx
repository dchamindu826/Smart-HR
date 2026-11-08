'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { ago, dateTime } from '@/lib/format';
import { Async, Button, Card, Chip, Empty, ErrorBox, Field, Input, Modal, PageHeader, Select, Toggle, useUi, type Tone } from '@/components/ui';
import { useAdmin } from '@/components/AdminShell';
import { CopyBox, ROLE_LABEL, roleCan, type AdminRole } from '../_admin';

interface AdminRow {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  active: boolean;
  totpEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

const ROLE_TONE: Record<AdminRole, Tone> = { SUPER_ADMIN: 'mag', ADMIN: 'info', SUPPORT: 'ok', SALES: 'warn' };
const ROLE_HELP: Record<AdminRole, string> = {
  SUPER_ADMIN: 'Everything, including other admins, plans and pricing, statutory rates and tax.',
  ADMIN: 'Companies, terminals, invoices and demo accounts.',
  SUPPORT: 'Read everything, open the support view and reset company passwords.',
  SALES: 'Create demo accounts and see analytics.',
};
const ROLE_OPTIONS = (Object.keys(ROLE_LABEL) as AdminRole[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }));

export default function AdminsPage() {
  const me = useAdmin();
  const { toast, confirm } = useUi();
  const act = useAction();
  const { data, error, loading, reload } = useApi<AdminRow[]>('/platform/admins');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AdminRow | null>(null);
  const [temp, setTemp] = useState<{ name: string; email: string; password: string } | null>(null);
  const isSuper = roleCan(me.role);

  const resetPassword = async (a: AdminRow) => {
    if ((await confirm({ title: `Reset the password for ${a.name}?`, body: 'Their current password stops working and they are logged out everywhere.', ok: 'Reset password', danger: true })) === false) return;
    const r = await act.run(() => api.patch<{ ok: boolean; tempPassword?: string }>(`/platform/admins/${a.id}`, { resetPassword: true }));
    if (r?.tempPassword) setTemp({ name: a.name, email: a.email, password: r.tempPassword });
  };

  const resetTotp = async (a: AdminRow) => {
    if ((await confirm({ title: `Turn off two-factor for ${a.name}?`, body: 'Use this when they lost their phone. They log in with the password only until they set it up again.', ok: 'Reset two-factor', danger: true })) === false) return;
    const r = await act.run(() => api.patch(`/platform/admins/${a.id}`, { resetTotp: true }));
    if (r !== undefined) {
      toast(`Two-factor turned off for ${a.name}.`);
      reload();
    }
  };

  const myRow = data?.find((a) => a.id === me.id);

  return (
    <>
      <PageHeader
        title="Admin logins"
        sub="Lumi AI staff who can use this panel. Every action is written to the platform audit."
        actions={
          isSuper && (
            <Button variant="pri" icon="key" onClick={() => setAdding(true)}>
              Add admin
            </Button>
          )
        }
      />
      <div className="stack">
        <ErrorBox error={act.error} />
        <Card pad={false}>
          <Async data={data} error={error} loading={loading}>
            {(rows) =>
              rows.length === 0 ? (
                <Empty title="No admins" icon="key" />
              ) : (
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Role</th>
                        <th>Two-factor</th>
                        <th>Status</th>
                        <th>Last login</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((a) => (
                        <tr key={a.id}>
                          <td>
                            <b>{a.name}</b> {a.id === me.id && <Chip tone="info">You</Chip>}
                          </td>
                          <td>{a.email}</td>
                          <td>
                            <Chip tone={ROLE_TONE[a.role]} title={ROLE_HELP[a.role]}>
                              {ROLE_LABEL[a.role]}
                            </Chip>
                          </td>
                          <td>{a.totpEnabled ? <Chip tone="ok">On</Chip> : <Chip tone="warn">Off</Chip>}</td>
                          <td>{a.active ? <Chip tone="ok">Active</Chip> : <Chip>Disabled</Chip>}</td>
                          <td className="nowrap" title={a.lastLoginAt ? dateTime(a.lastLoginAt) : undefined}>
                            {a.lastLoginAt ? ago(a.lastLoginAt) : 'Never'}
                          </td>
                          <td className="nowrap right">
                            {isSuper && (
                              <>
                                <Button size="xs" icon="edit" onClick={() => setEditing(a)}>
                                  Edit
                                </Button>{' '}
                                <Button size="xs" disabled={act.busy} onClick={() => resetPassword(a)}>
                                  Reset password
                                </Button>{' '}
                                {a.totpEnabled && (
                                  <Button size="xs" disabled={act.busy} onClick={() => resetTotp(a)}>
                                    Reset 2FA
                                  </Button>
                                )}
                              </>
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
        </Card>

        <div className="grid2">
          <TwoFactorCard enabled={!!myRow?.totpEnabled} onEnabled={reload} />
          <PasswordCard />
        </div>
      </div>

      {adding && (
        <AddAdminModal
          onClose={() => setAdding(false)}
          onDone={(name, email, password) => {
            setAdding(false);
            setTemp({ name, email, password });
            reload();
          }}
        />
      )}
      {editing && (
        <EditAdminModal
          admin={editing}
          self={editing.id === me.id}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            toast('Admin saved.');
            reload();
          }}
        />
      )}
      {temp && (
        <Modal title="Temporary password" size="narrow" onClose={() => setTemp(null)} footer={<Button onClick={() => setTemp(null)}>Done</Button>}>
          <div className="stack">
            <p>
              Give <b>{temp.name}</b> this password through a safe channel. It is shown only now. They log in at <span className="mono">/admin/login</span> and should change it straight away.
            </p>
            <CopyBox label="Email" value={temp.email} />
            <CopyBox label="Temporary password" value={temp.password} />
          </div>
        </Modal>
      )}
    </>
  );
}

function AddAdminModal({ onClose, onDone }: { onClose: () => void; onDone: (name: string, email: string, password: string) => void }) {
  const act = useAction();
  const [f, setF] = useState({ name: '', email: '', role: 'SUPPORT' as AdminRole });
  const save = async () => {
    const r = await act.run(() => api.post<{ id: string; tempPassword: string }>('/platform/admins', { name: f.name.trim(), email: f.email.trim(), role: f.role }));
    if (r !== undefined) onDone(f.name.trim(), f.email.trim().toLowerCase(), r.tempPassword);
  };
  return (
    <Modal
      title="Add admin"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="pri" busy={act.busy} disabled={f.name.trim().length < 2 || !f.email.includes('@')} onClick={save}>
            Add admin
          </Button>
        </>
      }
    >
      <div className="stack">
        <ErrorBox error={act.error} />
        <div className="form-grid">
          <Field label="Name" required>
            <Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Email" required hint="Their login. A temporary password is emailed too.">
            <Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </Field>
          <Field label="Role" required wide hint={ROLE_HELP[f.role]}>
            <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as AdminRole })} options={ROLE_OPTIONS} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function EditAdminModal({ admin, self, onClose, onDone }: { admin: AdminRow; self: boolean; onClose: () => void; onDone: () => void }) {
  const act = useAction();
  const [f, setF] = useState({ name: admin.name, role: admin.role, active: admin.active });
  const save = async () => {
    const r = await act.run(() => api.patch(`/platform/admins/${admin.id}`, { name: f.name.trim(), role: f.role, active: f.active }));
    if (r !== undefined) onDone();
  };
  return (
    <Modal
      title={`Edit ${admin.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="pri" busy={act.busy} disabled={f.name.trim().length < 2} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="stack">
        <ErrorBox error={act.error} />
        {self && <div className="alert info">You cannot remove your own super admin access or disable yourself.</div>}
        <div className="form-grid">
          <Field label="Name" required>
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Email">
            <Input value={admin.email} disabled />
          </Field>
          <Field label="Role" wide hint={ROLE_HELP[f.role]}>
            <Select value={f.role} disabled={self} onChange={(e) => setF({ ...f, role: e.target.value as AdminRole })} options={ROLE_OPTIONS} />
          </Field>
          <div className="field wide">
            <Toggle checked={f.active} disabled={self} onChange={(v) => setF({ ...f, active: v })} label={f.active ? 'Active — can log in' : 'Disabled — cannot log in (sessions are ended)'} />
          </div>
        </div>
      </div>
    </Modal>
  );
}

function TwoFactorCard({ enabled, onEnabled }: { enabled: boolean; onEnabled: () => void }) {
  const { toast, confirm } = useUi();
  const act = useAction();
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');

  const start = async () => {
    if (enabled && (await confirm({ title: 'Set up two-factor again?', body: 'Your current authenticator code stops working now. Two-factor stays off until you enter a code from the new key.', ok: 'Continue', danger: true })) === false) return;
    const r = await act.run(() => api.post<{ secret: string; otpauthUrl: string }>('/platform/me/totp/setup'));
    if (r !== undefined) {
      setSetup(r);
      setCode('');
      onEnabled();
    }
  };
  const enable = async () => {
    const r = await act.run(() => api.post('/platform/me/totp/enable', { code: code.trim() }));
    if (r !== undefined) {
      toast('Two-factor is on. You will need a code every time you log in.');
      setSetup(null);
      onEnabled();
    }
  };
  const grouped = setup ? setup.secret.replace(/(.{4})/g, '$1 ').trim() : '';

  return (
    <Card title="My security · two-factor" actions={enabled && !setup ? <Chip tone="ok">On</Chip> : !setup ? <Chip tone="warn">Off</Chip> : undefined}>
      <div className="stack">
        <ErrorBox error={act.error} />
        {!setup ? (
          <>
            <p className="small muted">
              {enabled
                ? 'You enter a 6-digit code from your authenticator app when you log in. Set it up again if you changed phones.'
                : 'Protect your admin login with a 6-digit code from Google Authenticator or Microsoft Authenticator.'}
            </p>
            <div>
              <Button variant={enabled ? '' : 'pri'} icon="shield" busy={act.busy} onClick={start}>
                {enabled ? 'Set up on a new phone' : 'Set up two-factor'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <ol className="small" style={{ paddingLeft: 18, display: 'grid', gap: 4 }}>
              <li>Open Google Authenticator or Microsoft Authenticator and choose to add an account by entering a setup key.</li>
              <li>Account name: your email. Key: the key below. Type: time based.</li>
              <li>Enter the 6-digit code the app shows.</li>
            </ol>
            <CopyBox label="Setup key" value={grouped} />
            <CopyBox label="otpauth link (for apps that accept a link)" value={setup.otpauthUrl} />
            <Field label="6-digit code" required>
              <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" className="mono" style={{ maxWidth: 160, letterSpacing: '0.2em' }} />
            </Field>
            <div className="row">
              <Button variant="pri" busy={act.busy} disabled={code.length !== 6} onClick={enable}>
                Turn on two-factor
              </Button>
              <Button variant="ghost" onClick={() => setSetup(null)}>
                Later
              </Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

function PasswordCard() {
  const { toast } = useUi();
  const act = useAction();
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const weak = f.next.length > 0 && (f.next.length < 8 || !/[A-Za-z]/.test(f.next) || !/\d/.test(f.next));
  const mismatch = f.confirm.length > 0 && f.confirm !== f.next;
  const save = async () => {
    const r = await act.run(() => api.post('/platform/me/password', { current: f.current, next: f.next }));
    if (r !== undefined) {
      toast('Password changed. Your other sessions were logged out.');
      setF({ current: '', next: '', confirm: '' });
    }
  };
  return (
    <Card title="My security · password">
      <div className="stack">
        <ErrorBox error={act.error} />
        <Field label="Current password" required>
          <Input type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} />
        </Field>
        <Field label="New password" required hint="At least 8 characters, with letters and a number." error={weak ? 'Use at least 8 characters, with letters and a number.' : null}>
          <Input type="password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} />
        </Field>
        <Field label="Confirm new password" required error={mismatch ? 'The passwords do not match.' : null}>
          <Input type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
        </Field>
        <div>
          <Button variant="pri" busy={act.busy} disabled={!f.current || !f.next || weak || f.confirm !== f.next} onClick={save}>
            Change password
          </Button>
        </div>
      </div>
    </Card>
  );
}
