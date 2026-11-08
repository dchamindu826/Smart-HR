'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { api, fileUrl } from '@/lib/api';
import { Alert, Avatar, Button, Card, Check, Chip, LinkButton, PageHeader, useUi } from '@/components/ui';

export default function MyProfilePage() {
  const { me, can, reload } = useAuth();
  const { toast, confirm } = useUi();
  const fileRef = useRef<HTMLInputElement>(null);
  const [photoV, setPhotoV] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [, setUpdatingPref] = useState(false);

  if (!me) return null;
  const u = me.user;
  const e = u.employee;

  const uploadPhoto = async (file: File | undefined) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      toast('Use a PNG, JPEG or WebP photo.', 'bad');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast('Photo must be smaller than 5 MB.', 'bad');
      return;
    }
    setUploading(true);
    try {
      await api.upload('/me/photo', file);
      toast('Profile photo updated.');
      setPhotoV(Date.now());
      await reload();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Could not upload photo.', 'bad');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removePhoto = async () => {
    const ok = await confirm({
      title: 'Remove profile photo?',
      body: 'Your photo will be removed and initials will be shown instead.',
      ok: 'Remove',
      danger: true,
    });
    if (!ok) return;

    setUploading(true);
    try {
      await api.del('/me/photo');
      toast('Profile photo removed.');
      setPhotoV(Date.now());
      await reload();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Could not remove photo.', 'bad');
    } finally {
      setUploading(false);
    }
  };

  const handleToggleBirthday = async (show: boolean) => {
    setUpdatingPref(true);
    try {
      await api.patch('/me/preferences', { birthdayOptOut: !show });
      toast(show ? 'Your birthday will be shown to colleagues.' : 'Your birthday is now hidden from colleagues.');
      await reload();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Could not update birthday preference.', 'bad');
    } finally {
      setUpdatingPref(false);
    }
  };

  const requestDeletion = async () => {
    const res = await confirm({
      title: 'Request account deletion?',
      body: 'Your request will be sent to HR. They will delete your login and notify you. Payroll and attendance records the company must keep by law are retained.',
      input: {
        label: 'Reason (optional)',
        placeholder: 'Why do you want to delete your login?',
        minLength: 0,
      },
      ok: 'Send request',
      danger: true,
    });
    if (res === false) return;
    try {
      const r = await api.post<{ ok: boolean; message: string }>('/me/deletion-request', { reason: res || null });
      toast(r.message);
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Could not submit request.', 'bad');
    }
  };

  const hasPhoto = !!(e?.photoPath || photoV);

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
          <Card title="Login & photo">
            <div className="row" style={{ marginBottom: 14, alignItems: 'center', gap: 16 }}>
              {photoV ? (
                <span className="avatar lg">
                  <img src={fileUrl('/me/photo', { v: photoV })} alt="" />
                </span>
              ) : (
                <Avatar name={u.name} photoEmployeeId={e?.photoPath ? e.id : null} size="lg" />
              )}
              <div className="grow">
                <h2 style={{ fontSize: 19 }}>{u.name}</h2>
                <Chip tone="info">{u.roleLabel}</Chip>
              </div>
            </div>

            {e ? (
              <div className="row tight" style={{ marginBottom: 16 }}>
                <Button
                  size="sm"
                  busy={uploading}
                  onClick={() => fileRef.current?.click()}
                  icon="upload"
                >
                  {hasPhoto ? 'Change photo' : 'Upload photo'}
                </Button>
                {hasPhoto && (
                  <Button
                    size="sm"
                    variant="danger"
                    busy={uploading}
                    onClick={removePhoto}
                    icon="trash"
                  >
                    Remove photo
                  </Button>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  onChange={(ev) => uploadPhoto(ev.target.files?.[0])}
                />
              </div>
            ) : null}

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

          <Card title="Birthday & privacy">
            <div className="stack tight">
              {e ? (
                <>
                  <p className="small muted">
                    Your profile photo is visible to your employer’s HR and colleagues in the same company.
                  </p>
                  <div style={{ marginTop: 8 }}>
                    <Check
                      checked={!e.birthdayOptOut}
                      onChange={handleToggleBirthday}
                      label={
                        <span>
                          <b>Show my birthday to colleagues</b>
                          <span className="small muted" style={{ display: 'block', marginTop: 2 }}>
                            Day and month only. Colleagues will see a reminder when it is your birthday. Your age is never shown.
                          </span>
                        </span>
                      }
                    />
                  </div>
                  {!e.dob && (
                    <p className="tiny faint" style={{ marginTop: 6 }}>
                      Date of birth has not been recorded on your employee record yet. Ask HR if you would like birthday celebrations.
                    </p>
                  )}
                </>
              ) : (
                <p className="small muted">
                  This login is not linked to an employee record, so birthday reminders are not active.
                </p>
              )}
            </div>
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

          <Card title="Account">
            <div className="stack tight">
              <div className="row between">
                <div>
                  <b>Delete my account</b>
                  <p className="small muted">
                    Request HR to delete your login.
                  </p>
                </div>
                <Button size="sm" variant="danger" onClick={requestDeletion}>
                  Request deletion
                </Button>
              </div>
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
                  {e.dob && (
                    <>
                      <dt>Date of birth</dt>
                      <dd>{e.dob}</dd>
                    </>
                  )}
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
