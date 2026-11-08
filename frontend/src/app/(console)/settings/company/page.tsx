'use client';

import { useEffect, useRef, useState } from 'react';
import { api, fileUrl } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { date, money } from '@/lib/format';
import { Alert, Async, Button, Card, Chip, ErrorBox, Field, Input, PageHeader, Progress, StatusChip, Textarea, useUi } from '@/components/ui';

const FIELDS = ['name', 'legalName', 'regNo', 'epfRegNo', 'etfRegNo', 'tinNo', 'vatNo', 'address', 'phone', 'email', 'website', 'industry', 'contactName'] as const;
type ProfileField = (typeof FIELDS)[number];

interface CompanyProfile extends Record<ProfileField, string | null> {
  code: string;
  status: 'TRIAL' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
  isDemo: boolean;
  trialEndsAt: string | null;
  demoExpiresAt: string | null;
  hasLogo: boolean;
  plan: { code: string; name: string; maxEmployees: number; priceMonthly: string | null; features: string[] };
  usage: { employees: number; maxEmployees: number };
  sampleEmployees: number;
}

const LABELS: Record<ProfileField, { label: string; hint?: string; wide?: boolean; max: number }> = {
  name: { label: 'Company name', hint: 'Shown in the app, on payslips and in emails.', max: 120 },
  legalName: { label: 'Legal name', hint: 'As registered, e.g. ABC (Private) Limited', max: 200 },
  regNo: { label: 'Business registration no.', hint: 'e.g. PV 12345', max: 40 },
  epfRegNo: { label: 'EPF employer number', hint: 'Used on EPF returns (C form).', max: 40 },
  etfRegNo: { label: 'ETF employer number', hint: 'Used on ETF returns.', max: 40 },
  tinNo: { label: 'TIN', hint: 'For APIT returns.', max: 40 },
  vatNo: { label: 'VAT number', max: 40 },
  industry: { label: 'Industry', max: 60 },
  address: { label: 'Address', wide: true, max: 300 },
  phone: { label: 'Phone', max: 30 },
  email: { label: 'Email', max: 120 },
  website: { label: 'Website', max: 120 },
  contactName: { label: 'Contact person', max: 100 },
};

export default function CompanySettingsPage() {
  const { can, reload: reloadMe } = useAuth();
  const { toast, confirm } = useUi();
  const { data, error, loading, reload } = useApi<CompanyProfile>('/settings/company');
  const [form, setForm] = useState<Record<ProfileField, string> | null>(null);
  const [logoV, setLogoV] = useState(() => Date.now());
  const [logoFailed, setLogoFailed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const act = useAction();
  const logoAct = useAction();
  const sampleAct = useAction();
  const editable = can('settings.edit');

  useEffect(() => {
    if (data) setForm(Object.fromEntries(FIELDS.map((f) => [f, data[f] ?? ''])) as Record<ProfileField, string>);
  }, [data]);

  const changed = data && form ? FIELDS.filter((f) => (data[f] ?? '') !== form[f]) : [];

  const save = async () => {
    if (!form) return;
    if (form.name.trim().length < 2) {
      act.setError('The company name needs at least 2 characters.');
      return;
    }
    const body: Record<string, string | null> = {};
    for (const f of changed) body[f] = f === 'name' ? form.name.trim() : form[f].trim() || null;
    const r = await act.run(() => api.patch('/settings/company', body));
    if (r !== undefined) {
      toast('Company details saved.');
      reload();
      if (changed.includes('name')) reloadMe();
    }
  };

  const uploadLogo = async (file: File | undefined) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.type)) {
      logoAct.setError('Use a PNG, JPEG, WebP or SVG image.');
      return;
    }
    const r = await logoAct.run(() => api.upload('/settings/company/logo', file));
    if (fileRef.current) fileRef.current.value = '';
    if (r !== undefined) {
      toast('Logo updated.');
      setLogoFailed(false);
      setLogoV(Date.now());
      reload();
      reloadMe();
    }
  };

  const clearSample = async (n: number) => {
    const ok = await confirm({
      title: 'Remove all sample data?',
      body: `This deletes the ${n} sample employees and everything made for them — their logins, attendance, leave, payslips, messages and sample assets. Your own records stay. This cannot be undone.`,
      ok: 'Remove sample data',
      danger: true,
    });
    if (ok === false) return;
    const r = await sampleAct.run(() => api.post<{ removed: number }>('/settings/clear-sample-data'));
    if (r !== undefined) {
      toast(r.removed ? `${r.removed} sample employees removed.` : 'There was no sample data left.');
      reload();
    }
  };

  return (
    <>
      <PageHeader title="Company and logo" sub="Your company details appear on payslips, statutory returns and the employee app." />
      <Async data={data} error={error} loading={loading}>
        {(d) => (
          <div className="grid-main">
            <div>
              <Card
                title="Company profile"
                sub={`Company code ${d.code}`}
                footer={
                  editable ? (
                    <>
                      {changed.length > 0 && (
                        <Button onClick={() => setForm(Object.fromEntries(FIELDS.map((f) => [f, d[f] ?? ''])) as Record<ProfileField, string>)}>Undo changes</Button>
                      )}
                      <Button variant="pri" busy={act.busy} disabled={changed.length === 0} onClick={save}>
                        Save
                      </Button>
                    </>
                  ) : undefined
                }
              >
                {form && (
                  <div className="stack">
                    {!editable && <Alert tone="info">Only the owner or Head of HR can change these details.</Alert>}
                    <div className="form-grid">
                      {FIELDS.map((f) => {
                        const meta = LABELS[f];
                        return (
                          <Field key={f} label={meta.label} hint={meta.hint} required={f === 'name'} wide={meta.wide}>
                            {f === 'address' ? (
                              <Textarea value={form[f]} disabled={!editable} maxLength={meta.max} onChange={(e) => setForm({ ...form, [f]: e.target.value })} style={{ minHeight: 60 }} />
                            ) : (
                              <Input
                                value={form[f]}
                                disabled={!editable}
                                maxLength={meta.max}
                                type={f === 'email' ? 'email' : f === 'website' ? 'url' : f === 'phone' ? 'tel' : 'text'}
                                onChange={(e) => setForm({ ...form, [f]: e.target.value })}
                              />
                            )}
                          </Field>
                        );
                      })}
                    </div>
                    <ErrorBox error={act.error} />
                  </div>
                )}
              </Card>
            </div>

            <div>
              <Card title="Logo" sub="On payslips, the app and this console">
                <div className="stack">
                  <div
                    style={{
                      display: 'grid',
                      placeItems: 'center',
                      minHeight: 120,
                      background: 'var(--card-2)',
                      border: '1px dashed var(--rule-2)',
                      borderRadius: 10,
                      padding: 14,
                    }}
                  >
                    {d.hasLogo && !logoFailed ? (
                      <img src={fileUrl('/settings/company/logo', { v: logoV })} alt={`${d.name ?? 'Company'} logo`} style={{ maxHeight: 110, maxWidth: '100%', objectFit: 'contain' }} onError={() => setLogoFailed(true)} />
                    ) : (
                      <span className="muted small">No logo yet</span>
                    )}
                  </div>
                  {editable && (
                    <>
                      <input ref={fileRef} type="file" hidden accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(e) => uploadLogo(e.target.files?.[0])} />
                      <Button icon="upload" busy={logoAct.busy} onClick={() => fileRef.current?.click()}>
                        {d.hasLogo ? 'Replace logo' : 'Upload logo'}
                      </Button>
                      <p className="small faint">PNG, JPEG, WebP or SVG up to 10 MB. A wide logo on a transparent background looks best.</p>
                    </>
                  )}
                  <ErrorBox error={logoAct.error} />
                </div>
              </Card>

              <Card title="Plan and usage" actions={<StatusChip status={d.status} />}>
                <div className="stack tight">
                  <div className="row between">
                    <b>{d.plan.name} plan</b>
                    {d.plan.priceMonthly && <span className="muted small">Rs {money(d.plan.priceMonthly)} / month</span>}
                  </div>
                  <div className="row between small">
                    <span className="muted">Active employees</span>
                    <span>
                      <b>{d.usage.employees}</b> of {d.usage.maxEmployees}
                    </span>
                  </div>
                  <Progress
                    value={d.usage.employees}
                    max={d.usage.maxEmployees}
                    tone={d.usage.employees >= d.usage.maxEmployees ? 'bad' : d.usage.employees / Math.max(1, d.usage.maxEmployees) >= 0.85 ? 'warn' : 'ok'}
                  />
                  {d.usage.employees >= d.usage.maxEmployees && <Alert tone="warn">You have reached the plan limit. Contact Lumi AI to move to a bigger plan before adding more employees.</Alert>}
                  {d.status === 'TRIAL' && d.trialEndsAt && <div className="small muted">Trial ends {date(d.trialEndsAt)}.</div>}
                  {d.isDemo && d.demoExpiresAt && <div className="small muted">This demo account closes on {date(d.demoExpiresAt)}.</div>}
                  <div className="row tight" style={{ marginTop: 4 }}>
                    {d.plan.features.map((f) => (
                      <Chip key={f}>{f.replace(/_/g, ' ')}</Chip>
                    ))}
                  </div>
                </div>
              </Card>

              <Card title="Sample data">
                <div className="stack tight">
                  {d.sampleEmployees > 0 ? (
                    <>
                      <p>
                        This account has <b>{d.sampleEmployees} sample employees</b> with made-up attendance, leave and pay, so you can try every screen. They are marked <Chip tone="mag">Sample</Chip> in the employee list.
                      </p>
                      <p className="small muted">Remove them before you start using SmartHR for real. Your own employees and settings are not touched.</p>
                      {can('sample.clear') ? (
                        <div>
                          <Button variant="danger" icon="trash" busy={sampleAct.busy} onClick={() => clearSample(d.sampleEmployees)}>
                            Remove sample data
                          </Button>
                        </div>
                      ) : (
                        <p className="small faint">Ask the owner or Head of HR to remove it.</p>
                      )}
                      <ErrorBox error={sampleAct.error} />
                    </>
                  ) : (
                    <p className="muted small">
                      There is no sample data in this account. Only demo accounts start with sample employees — a new company always starts empty, with just your own records.
                    </p>
                  )}
                </div>
              </Card>
            </div>
          </div>
        )}
      </Async>
    </>
  );
}
