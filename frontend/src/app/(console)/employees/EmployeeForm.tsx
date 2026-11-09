'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { today } from '@/lib/format';
import { BranchSelect, DepartmentSelect, EmployeePicker } from '@/components/pickers';
import { Alert, Button, Card, Check, ErrorBox, Field, Input, Loading, Modal, Select, Textarea, useUi } from '@/components/ui';

/** The profile as GET /employees/:id returns it (only the fields this form edits). */
export interface EmployeeRecord {
  id: string;
  empNo: string;
  title: string | null;
  firstName: string;
  lastName: string;
  nameWithInitials: string | null;
  callingName: string | null;
  nic: string | null;
  dob: string | null;
  gender: 'MALE' | 'FEMALE' | 'OTHER' | null;
  maritalStatus: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  branchId: string | null;
  departmentId: string | null;
  designation: string | null;
  grade: string | null;
  managerId: string | null;
  employmentType: string;
  joinDate: string;
  confirmDate: string | null;
  payType?: 'MONTHLY' | 'DAILY';
  basicSalary?: string | null;
  epfNo?: string | null;
  epfEligible?: boolean;
  otEligible?: boolean;
  bankName?: string | null;
  bankCode?: string | null;
  bankBranchCode?: string | null;
  accountNo?: string | null;
  accountName?: string | null;
  defaultShiftPatternId: string | null;
  rosterGroupId: string | null;
  allowRemote: boolean | null;
  requireLocation: boolean | null;
  requireFace: boolean | null;
  remoteAddress: string | null;
  remoteLat: number | null;
  remoteLng: number | null;
  birthdayOptOut: boolean;
  canSeePay: boolean;
}

interface ShiftLite {
  id: string;
  code: string;
  name: string;
  active: boolean;
}
interface GroupLite {
  id: string;
  name: string;
}
interface CreateResult {
  id: string;
  empNo: string;
  login: { tempPassword: string; login?: string | null } | null;
}

type Tri = '' | 'true' | 'false';

interface FormState {
  empNo: string;
  title: string;
  firstName: string;
  lastName: string;
  nameWithInitials: string;
  callingName: string;
  nic: string;
  dob: string;
  gender: string;
  maritalStatus: string;
  phone: string;
  email: string;
  address: string;
  emergencyName: string;
  emergencyPhone: string;
  branchId: string;
  departmentId: string;
  designation: string;
  grade: string;
  managerId: string | null;
  employmentType: string;
  joinDate: string;
  confirmDate: string;
  payType: 'MONTHLY' | 'DAILY';
  basicSalary: string;
  epfNo: string;
  epfEligible: boolean;
  otEligible: boolean;
  bankName: string;
  bankCode: string;
  bankBranchCode: string;
  accountNo: string;
  accountName: string;
  defaultShiftPatternId: string;
  rosterGroupId: string;
  allowRemote: Tri;
  requireLocation: Tri;
  requireFace: Tri;
  remoteAddress: string;
  remoteLat: string;
  remoteLng: string;
  birthdayOptOut: boolean;
}

const EMPTY: FormState = {
  empNo: '', title: '', firstName: '', lastName: '', nameWithInitials: '', callingName: '', nic: '', dob: '', gender: '', maritalStatus: '',
  phone: '', email: '', address: '', emergencyName: '', emergencyPhone: '', branchId: '', departmentId: '', designation: '', grade: '',
  managerId: null, employmentType: 'PROBATION', joinDate: today(), confirmDate: '', payType: 'MONTHLY', basicSalary: '', epfNo: '',
  epfEligible: true, otEligible: true, bankName: '', bankCode: '', bankBranchCode: '', accountNo: '', accountName: '',
  defaultShiftPatternId: '', rosterGroupId: '', allowRemote: '', requireLocation: '', requireFace: '', remoteAddress: '', remoteLat: '', remoteLng: '',
  birthdayOptOut: false,
};

const d10 = (v: string | null | undefined) => (v ? v.slice(0, 10) : '');
const s = (v: string | null | undefined) => v ?? '';
const tri = (v: boolean | null | undefined): Tri => (v === true ? 'true' : v === false ? 'false' : '');
const fromTri = (v: Tri): boolean | null => (v === 'true' ? true : v === 'false' ? false : null);
const orNull = (v: string) => (v.trim() === '' ? null : v.trim());

function fromRecord(e: EmployeeRecord): FormState {
  return {
    empNo: e.empNo, title: s(e.title), firstName: e.firstName, lastName: e.lastName, nameWithInitials: s(e.nameWithInitials), callingName: s(e.callingName),
    nic: s(e.nic), dob: d10(e.dob), gender: s(e.gender), maritalStatus: s(e.maritalStatus), phone: s(e.phone), email: s(e.email), address: s(e.address),
    emergencyName: s(e.emergencyName), emergencyPhone: s(e.emergencyPhone), branchId: s(e.branchId), departmentId: s(e.departmentId),
    designation: s(e.designation), grade: s(e.grade), managerId: e.managerId, employmentType: e.employmentType, joinDate: d10(e.joinDate),
    confirmDate: d10(e.confirmDate), payType: e.payType ?? 'MONTHLY', basicSalary: e.basicSalary ?? '', epfNo: s(e.epfNo),
    epfEligible: e.epfEligible ?? true, otEligible: e.otEligible ?? true, bankName: s(e.bankName), bankCode: s(e.bankCode),
    bankBranchCode: s(e.bankBranchCode), accountNo: s(e.accountNo), accountName: s(e.accountName),
    defaultShiftPatternId: s(e.defaultShiftPatternId), rosterGroupId: s(e.rosterGroupId), allowRemote: tri(e.allowRemote),
    requireLocation: tri(e.requireLocation), requireFace: tri(e.requireFace), remoteAddress: s(e.remoteAddress),
    remoteLat: e.remoteLat === null ? '' : String(e.remoteLat), remoteLng: e.remoteLng === null ? '' : String(e.remoteLng), birthdayOptOut: e.birthdayOptOut,
  };
}

const TRI_OPTIONS = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
];
const TYPES = [
  { value: 'PERMANENT', label: 'Permanent' },
  { value: 'PROBATION', label: 'Probation' },
  { value: 'CONTRACT', label: 'Contract' },
  { value: 'TRAINEE', label: 'Trainee' },
  { value: 'CASUAL', label: 'Casual' },
];

export function EmployeeForm({ id }: { id?: string }) {
  const isNew = !id;
  const router = useRouter();
  const { can, has } = useAuth();
  const { toast } = useUi();
  const canPayView = can('employee.pay.view');
  const canPayEdit = can('employee.pay.edit');

  const [f, setF] = useState<FormState>(EMPTY);
  const [loaded, setLoaded] = useState(isNew);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createLogin, setCreateLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [locating, setLocating] = useState(false);
  const [created, setCreated] = useState<CreateResult | null>(null);

  const shifts = useApi<ShiftLite[]>('/shifts');
  const groups = useApi<GroupLite[]>(has('roster') ? '/roster/groups' : null);

  useEffect(() => {
    let off = false;
    if (id) {
      api
        .get<EmployeeRecord>(`/employees/${id}`)
        .then((e) => {
          if (off) return;
          setF(fromRecord(e));
          setLoaded(true);
        })
        .catch((e) => !off && setLoadError(errorMessage(e)));
    } else {
      api
        .get<{ empNo: string }>('/employees/next-number')
        .then((r) => !off && setF((x) => (x.empNo ? x : { ...x, empNo: r.empNo })))
        .catch(() => undefined);
    }
    return () => {
      off = true;
    };
  }, [id]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    if (fieldErrors[k]) setFieldErrors((x) => ({ ...x, [k]: undefined }));
  };
  const txt = (k: keyof FormState) => ({
    value: f[k] as string,
    onChange: (e: { target: { value: string } }) => set(k, e.target.value as never),
  });

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      toast('This browser cannot share its location.', 'bad');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setF((x) => ({ ...x, remoteLat: p.coords.latitude.toFixed(6), remoteLng: p.coords.longitude.toFixed(6) }));
        setLocating(false);
        toast(`Location set (accuracy about ${Math.round(p.coords.accuracy)} m).`);
      },
      (err) => {
        setLocating(false);
        toast(err.code === err.PERMISSION_DENIED ? 'Location permission was refused.' : 'Could not get your location.', 'bad');
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const localCheck = (): Partial<Record<keyof FormState, string>> => {
    const e: Partial<Record<keyof FormState, string>> = {};
    if (!f.firstName.trim()) e.firstName = 'Required.';
    if (!f.lastName.trim()) e.lastName = 'Required.';
    if (!f.joinDate) e.joinDate = 'Required.';
    const lat = f.remoteLat.trim();
    const lng = f.remoteLng.trim();
    if (lat && (!Number.isFinite(Number(lat)) || Math.abs(Number(lat)) > 90)) e.remoteLat = 'Between -90 and 90.';
    if (lng && (!Number.isFinite(Number(lng)) || Math.abs(Number(lng)) > 180)) e.remoteLng = 'Between -180 and 180.';
    if ((lat && !lng) || (!lat && lng)) e.remoteLat = 'Give both latitude and longitude, or neither.';
    if (canPayEdit && f.basicSalary.trim() && !/^\d+(\.\d{1,2})?$/.test(f.basicSalary.replace(/,/g, '').trim())) e.basicSalary = 'Enter an amount like 65000.00.';
    return e;
  };

  const body = (): Record<string, unknown> => {
    const b: Record<string, unknown> = {
      title: orNull(f.title),
      firstName: f.firstName.trim(),
      lastName: f.lastName.trim(),
      nameWithInitials: orNull(f.nameWithInitials),
      callingName: orNull(f.callingName),
      nic: orNull(f.nic),
      dob: f.dob || null,
      gender: f.gender || null,
      maritalStatus: orNull(f.maritalStatus),
      phone: orNull(f.phone),
      email: orNull(f.email),
      address: orNull(f.address),
      emergencyName: orNull(f.emergencyName),
      emergencyPhone: orNull(f.emergencyPhone),
      branchId: f.branchId || null,
      departmentId: f.departmentId || null,
      designation: orNull(f.designation),
      grade: orNull(f.grade),
      managerId: f.managerId || null,
      employmentType: f.employmentType,
      joinDate: f.joinDate,
      confirmDate: f.confirmDate || null,
      defaultShiftPatternId: f.defaultShiftPatternId || null,
      allowRemote: fromTri(f.allowRemote),
      requireLocation: fromTri(f.requireLocation),
      requireFace: fromTri(f.requireFace),
      remoteAddress: orNull(f.remoteAddress),
      remoteLat: f.remoteLat.trim() ? Number(f.remoteLat) : null,
      remoteLng: f.remoteLng.trim() ? Number(f.remoteLng) : null,
      birthdayOptOut: f.birthdayOptOut,
    };
    if (has('roster')) b.rosterGroupId = f.rosterGroupId || null;
    if (f.empNo.trim()) b.empNo = f.empNo.trim();
    // Pay fields only go to the backend from someone allowed to change them.
    if (canPayEdit) {
      Object.assign(b, {
        payType: f.payType,
        basicSalary: f.basicSalary.replace(/,/g, '').trim() || '0',
        epfNo: orNull(f.epfNo),
        epfEligible: f.epfEligible,
        otEligible: f.otEligible,
        bankName: orNull(f.bankName),
        bankCode: orNull(f.bankCode),
        bankBranchCode: orNull(f.bankBranchCode),
        accountNo: orNull(f.accountNo),
        accountName: orNull(f.accountName),
      });
    }
    if (isNew && createLogin) b.createLogin = true;
    return b;
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setError(null);
    const local = localCheck();
    if (Object.keys(local).length) {
      setFieldErrors(local);
      setError('Please fix the marked fields.');
      return;
    }
    setBusy(true);
    try {
      if (isNew) {
        const r = await api.post<CreateResult>('/employees', body());
        if (r.login) {
          setCreated(r);
          toast(`Employee ${r.empNo} added with an app login.`);
        } else {
          toast(createLogin ? `Employee ${r.empNo} added. No login made — add an email or mobile first.` : `Employee ${r.empNo} added.`);
          router.push(`/employees/${r.id}`);
        }
      } else {
        await api.patch(`/employees/${id}`, body());
        toast('Changes saved.');
        router.push(`/employees/${id}`);
      }
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiError && Array.isArray(e.details)) {
        const fe: Partial<Record<keyof FormState, string>> = {};
        for (const d of e.details as { field?: string; message?: string }[]) {
          const k = (d.field ?? '') as keyof FormState;
          if (k && k in EMPTY && d.message) fe[k] = d.message;
        }
        setFieldErrors(fe);
      } else if (e instanceof ApiError && /employee number/i.test(e.message)) {
        setFieldErrors({ empNo: e.message });
      }
    } finally {
      setBusy(false);
    }
  };

  if (loadError) return <Alert>{loadError}</Alert>;
  if (!loaded) return <Loading />;

  const fe = (k: keyof FormState) => fieldErrors[k] ?? null;
  const payDisabled = !canPayEdit;
  const shiftOptions = (shifts.data ?? []).filter((x) => x.active || x.id === f.defaultShiftPatternId).map((x) => ({ value: x.id, label: `${x.name} (${x.code})` }));
  const mapsUrl = f.remoteLat && f.remoteLng ? `https://maps.google.com/?q=${encodeURIComponent(f.remoteLat)},${encodeURIComponent(f.remoteLng)}` : null;

  return (
    <form onSubmit={submit} noValidate>
      <div>
        <Section title="Personal">
          <div className="form-grid">
            <Field label="Title">
              <Select {...txt('title')} placeholder="—" options={['Mr', 'Mrs', 'Ms', 'Miss', 'Dr', 'Rev'].map((v) => ({ value: v, label: v }))} />
            </Field>
            <Field label="First name" required error={fe('firstName')}>
              <Input {...txt('firstName')} maxLength={60} autoFocus={isNew} />
            </Field>
            <Field label="Last name" required error={fe('lastName')}>
              <Input {...txt('lastName')} maxLength={60} />
            </Field>
            <Field label="Name with initials" error={fe('nameWithInitials')} hint="As on the NIC, e.g. K. A. Perera">
              <Input {...txt('nameWithInitials')} maxLength={120} />
            </Field>
            <Field label="Calling name" error={fe('callingName')}>
              <Input {...txt('callingName')} maxLength={40} />
            </Field>
            <Field label="NIC" error={fe('nic')} hint="123456789V or 200012345678">
              <Input {...txt('nic')} maxLength={12} style={{ textTransform: 'uppercase' }} />
            </Field>
            <Field label="Date of birth" error={fe('dob')}>
              <Input type="date" {...txt('dob')} max={today()} />
            </Field>
            <Field label="Gender" error={fe('gender')}>
              <Select {...txt('gender')} placeholder="—" options={[{ value: 'MALE', label: 'Male' }, { value: 'FEMALE', label: 'Female' }, { value: 'OTHER', label: 'Other' }]} />
            </Field>
            <Field label="Marital status" error={fe('maritalStatus')}>
              <Select {...txt('maritalStatus')} placeholder="—" options={['Single', 'Married', 'Divorced', 'Widowed'].map((v) => ({ value: v, label: v }))} />
            </Field>
            <Field label="Mobile" error={fe('phone')} hint="0771234567">
              <Input type="tel" {...txt('phone')} maxLength={16} />
            </Field>
            <Field label="Email" error={fe('email')}>
              <Input type="email" {...txt('email')} maxLength={120} />
            </Field>
            <Field label="Address" error={fe('address')} wide>
              <Textarea {...txt('address')} maxLength={300} style={{ minHeight: 60 }} />
            </Field>
            <Field label="Emergency contact name" error={fe('emergencyName')}>
              <Input {...txt('emergencyName')} maxLength={100} />
            </Field>
            <Field label="Emergency contact phone" error={fe('emergencyPhone')}>
              <Input type="tel" {...txt('emergencyPhone')} maxLength={30} />
            </Field>
          </div>
        </Section>

        <Section title="Job">
          <div className="form-grid">
            <Field label="Employee number" error={fe('empNo')} hint={isNew ? 'Next free number filled in. Leave blank to number automatically.' : undefined}>
              <Input {...txt('empNo')} maxLength={20} />
            </Field>
            <Field label="Branch" error={fe('branchId')}>
              <BranchSelect value={f.branchId} onChange={(v) => set('branchId', v)} placeholder="No branch" />
            </Field>
            <Field label="Department" error={fe('departmentId')}>
              <DepartmentSelect value={f.departmentId} onChange={(v) => set('departmentId', v)} placeholder="No department" />
            </Field>
            <Field label="Designation" error={fe('designation')}>
              <Input {...txt('designation')} maxLength={80} />
            </Field>
            <Field label="Grade" error={fe('grade')}>
              <Input {...txt('grade')} maxLength={20} />
            </Field>
            <Field label="Reports to" error={fe('managerId')}>
              <EmployeePicker value={f.managerId} onChange={(v) => set('managerId', v)} placeholder="Search for the manager…" />
            </Field>
            <Field label="Employment type" error={fe('employmentType')}>
              <Select {...txt('employmentType')} options={TYPES} />
            </Field>
            <Field label="Join date" required error={fe('joinDate')}>
              <Input type="date" {...txt('joinDate')} />
            </Field>
            <Field label="Confirmation date" error={fe('confirmDate')} hint="When probation ended">
              <Input type="date" {...txt('confirmDate')} />
            </Field>
          </div>
        </Section>

        {canPayView && (
          <Section title="Pay" sub={payDisabled ? 'You can see pay details but not change them.' : 'Bank details are used for the salary bank file.'}>
            <div className="form-grid">
              <Field label="Pay type" error={fe('payType')}>
                <Select value={f.payType} onChange={(e) => set('payType', e.target.value as FormState['payType'])} disabled={payDisabled} options={[{ value: 'MONTHLY', label: 'Monthly salary' }, { value: 'DAILY', label: 'Daily wage' }]} />
              </Field>
              <Field label={f.payType === 'DAILY' ? 'Daily rate (Rs)' : 'Basic salary (Rs)'} error={fe('basicSalary')}>
                <Input inputMode="decimal" {...txt('basicSalary')} disabled={payDisabled} placeholder="0.00" />
              </Field>
              <Field label="EPF number" error={fe('epfNo')}>
                <Input {...txt('epfNo')} maxLength={20} disabled={payDisabled} />
              </Field>
              <Field label="Bank name" error={fe('bankName')}>
                <Input {...txt('bankName')} maxLength={80} disabled={payDisabled} />
              </Field>
              <Field label="Bank code" error={fe('bankCode')} hint="4 digits, e.g. 7010">
                <Input {...txt('bankCode')} maxLength={10} disabled={payDisabled} />
              </Field>
              <Field label="Bank branch code" error={fe('bankBranchCode')}>
                <Input {...txt('bankBranchCode')} maxLength={10} disabled={payDisabled} />
              </Field>
              <Field label="Account number" error={fe('accountNo')}>
                <Input {...txt('accountNo')} maxLength={30} disabled={payDisabled} />
              </Field>
              <Field label="Account name" error={fe('accountName')}>
                <Input {...txt('accountName')} maxLength={100} disabled={payDisabled} />
              </Field>
              <div className="field wide">
                <div className="row" style={{ gap: 24 }}>
                  <CheckField checked={f.epfEligible} disabled={payDisabled} onChange={(v) => set('epfEligible', v)} label="EPF / ETF applies" />
                  <CheckField checked={f.otEligible} disabled={payDisabled} onChange={(v) => set('otEligible', v)} label="Paid for overtime" />
                </div>
              </div>
            </div>
          </Section>
        )}

        <Section title="Time and attendance" sub="Leave a rule on Company setting to follow Attendance & pay rules.">
          <div className="form-grid">
            <Field label="Default shift" hint="Used on days without a roster.">
              <Select {...txt('defaultShiftPatternId')} placeholder="Company working day" options={shiftOptions} />
            </Field>
            {has('roster') && (
              <Field label="Roster group">
                <Select {...txt('rosterGroupId')} placeholder="Not in a roster group" options={(groups.data ?? []).map((g) => ({ value: g.id, label: g.name }))} />
              </Field>
            )}
            <Field label="May work remotely">
              <Select value={f.allowRemote} onChange={(e) => set('allowRemote', e.target.value as Tri)} placeholder="Company setting" options={TRI_OPTIONS} />
            </Field>
            <Field label="Location needed for attendance">
              <Select value={f.requireLocation} onChange={(e) => set('requireLocation', e.target.value as Tri)} placeholder="Company setting" options={TRI_OPTIONS} />
            </Field>
            <Field label="Face check" hint={has('face') ? undefined : 'Needs the Complete plan.'}>
              <Select value={f.requireFace} onChange={(e) => set('requireFace', e.target.value as Tri)} placeholder="Company setting" options={TRI_OPTIONS} disabled={!has('face') && f.requireFace === ''} />
            </Field>
            <Field label="Remote work address" wide error={fe('remoteAddress')}>
              <Input {...txt('remoteAddress')} maxLength={300} placeholder="Home or site address, for remote mark-ins" />
            </Field>
            <Field label="Remote latitude" error={fe('remoteLat')}>
              <Input inputMode="decimal" {...txt('remoteLat')} placeholder="6.9271" />
            </Field>
            <Field label="Remote longitude" error={fe('remoteLng')}>
              <Input inputMode="decimal" {...txt('remoteLng')} placeholder="79.8612" />
            </Field>
            <div className="field" style={{ justifyContent: 'flex-end' }}>
              <div className="row tight">
                <Button size="sm" icon="pin" busy={locating} onClick={useMyLocation}>
                  Use my current location
                </Button>
                {mapsUrl && (
                  <a className="btn sm ghost" href={mapsUrl} target="_blank" rel="noreferrer">
                    Check on map
                  </a>
                )}
              </div>
            </div>
            <div className="field wide">
              <Check checked={f.birthdayOptOut} onChange={(v) => set('birthdayOptOut', v)} label="Do not announce this person's birthday" />
            </div>
          </div>
        </Section>

        {isNew && can('employee.account') && (
          <Card>
            <Check checked={createLogin} onChange={setCreateLogin} label="Create an app login and email the details" />
            <p className="small faint" style={{ marginTop: 6, marginLeft: 24 }}>
              Uses the email above, or the mobile number when there is no email. You will see the temporary password once.
            </p>
          </Card>
        )}

        <div className="stack" style={{ marginTop: 16 }}>
          <ErrorBox error={error} />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Link className="btn" href={id ? `/employees/${id}` : '/employees'}>
            Cancel
          </Link>
          <Button type="submit" variant="pri" busy={busy}>
            {isNew ? 'Add employee' : 'Save changes'}
            </Button>
          </div>
        </div>
      </div>

      {created && created.login && (
        <Modal
          title="Employee added"
          size="narrow"
          onClose={() => router.push(`/employees/${created.id}`)}
          footer={
            <Button variant="pri" onClick={() => router.push(`/employees/${created.id}`)}>
              Open profile
            </Button>
          }
        >
          <div className="stack">
            <p>
              An app login was created{created.login.login ? <> for <b>{created.login.login}</b></> : null}. Give the employee this temporary password — it is shown only once.
            </p>
            <TempPassword value={created.login.tempPassword} />
          </div>
        </Modal>
      )}
    </form>
  );
}

function Section({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <Card title={title} sub={sub}>
      {children}
    </Card>
  );
}

function CheckField({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="check" style={disabled ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function TempPassword({ value }: { value: string }) {
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
