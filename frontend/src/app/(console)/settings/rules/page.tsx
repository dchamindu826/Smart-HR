'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { dur, hhmm, parseHhmm } from '@/lib/format';
import { Alert, Async, Button, Card, Chip, ErrorBox, Input, PageHeader, Select, Toggle, useUi } from '@/components/ui';

interface Settings {
  normalDayMinutes: number;
  mealMinutes: number;
  mealStart: number;
  mealEnd: number;
  graceMinutes: number;
  otMinMinutes: number;
  otRoundMinutes: number;
  workWeek: number[];
  weeklyOtCapMinutes: number;
  maxDayMinutes: number;
  minRestMinutes: number;
  requireLocation: boolean;
  requireFace: boolean;
  allowRemote: boolean;
  officeMustBeInFence: boolean;
  remoteFlagMeters: number;
  maxAccuracyM: number;
  allowWebPunch: boolean;
  otRatePct: number;
  otDivisorHours: number;
  noPayDivisorDays: number;
  payDay: number;
  absentIsNoPay: boolean;
  autoReleasePayslips: boolean;
  leaveYearStartMonth: number;
  birthdayNotifications: boolean;
  notifyManagerOnLate: boolean;
  rosterRequiresApproval: boolean;
}
type Key = keyof Settings;
type NumKey = { [K in Key]: Settings[K] extends number ? K : never }[Key];
type BoolKey = { [K in Key]: Settings[K] extends boolean ? K : never }[Key];

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Limits from the backend schema, so the form can say what is wrong before saving. */
const LIMITS: Partial<Record<NumKey, [number, number]>> = {
  normalDayMinutes: [60, 720],
  mealMinutes: [0, 120],
  graceMinutes: [0, 120],
  otMinMinutes: [0, 240],
  otRoundMinutes: [1, 60],
  maxDayMinutes: [60, 1440],
  minRestMinutes: [0, 1440],
  remoteFlagMeters: [100, 50000],
  maxAccuracyM: [10, 1000],
  otRatePct: [100, 300],
  otDivisorHours: [150, 300],
  noPayDivisorDays: [20, 31],
  payDay: [1, 31],
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function Row({ title, help, children }: { title: ReactNode; help?: ReactNode; children: ReactNode }) {
  return (
    <div className="setting">
      <div>
        <b>{title}</b>
        {help && <p>{help}</p>}
      </div>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>{children}</div>
    </div>
  );
}

/** A minutes value edited as hours (decimals allowed). Keeps its own text while typing. */
function HoursInput({ minutes, onChange, disabled, width = 80, step = 0.5 }: { minutes: number; onChange: (m: number) => void; disabled?: boolean; width?: number; step?: number }) {
  const [txt, setTxt] = useState(String(+(minutes / 60).toFixed(2)));
  useEffect(() => {
    if (Math.round(Number(txt) * 60) !== minutes) setTxt(String(+(minutes / 60).toFixed(2)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minutes]);
  return (
    <Input
      type="number"
      className="sm right"
      style={{ width }}
      min={0}
      step={step}
      disabled={disabled}
      value={txt}
      onChange={(e) => {
        setTxt(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value !== '' && Number.isFinite(n)) onChange(Math.round(n * 60));
      }}
    />
  );
}

export default function RulesPage() {
  const { can, has } = useAuth();
  const { toast } = useUi();
  const { data, error, loading, setData } = useApi<Settings>('/settings');
  const [s, setS] = useState<Settings | null>(null);
  const act = useAction();
  const ro = !can('settings.edit');

  useEffect(() => {
    if (data) setS(data);
  }, [data]);

  const changed: Key[] = data && s ? (Object.keys(s) as Key[]).filter((k) => k !== 'weeklyOtCapMinutes' && !same(s[k], data[k])) : [];

  const problems: string[] = [];
  if (s) {
    for (const [k, [lo, hi]] of Object.entries(LIMITS) as [NumKey, [number, number]][]) {
      const v = s[k];
      if (!Number.isFinite(v) || v < lo || v > hi) problems.push(`${k}`);
    }
    if (s.mealEnd <= s.mealStart) problems.push('meal');
    if (s.workWeek.some((m) => m < 0 || m > 720)) problems.push('workWeek');
  }

  const setK = <K extends Key>(k: K, v: Settings[K]) => setS((x) => (x ? { ...x, [k]: v } : x));
  const num = (k: NumKey, opts: { width?: number; step?: number; suffix?: string } = {}) =>
    s && (
      <>
        <Input
          type="number"
          className="sm right"
          style={{ width: opts.width ?? 90, ...(problems.includes(k) ? { borderColor: 'var(--bad)' } : {}) }}
          step={opts.step ?? 1}
          min={LIMITS[k]?.[0]}
          max={LIMITS[k]?.[1]}
          disabled={ro}
          value={Number.isFinite(s[k]) ? s[k] : ''}
          onChange={(e) => setK(k, e.target.value === '' ? NaN : Number(e.target.value))}
        />
        {opts.suffix && <span className="muted small">{opts.suffix}</span>}
      </>
    );
  const tog = (k: BoolKey, disabled = false) => s && <Toggle checked={s[k]} disabled={ro || disabled} onChange={(v) => setK(k, v)} />;
  const range = (k: NumKey) => (LIMITS[k] ? `Allowed ${LIMITS[k]![0]}–${LIMITS[k]![1]}.` : '');

  const save = async () => {
    if (!s || !data) return;
    const patch: Partial<Settings> = {};
    for (const k of changed) (patch as Record<string, unknown>)[k] = s[k];
    const r = await act.run(() => api.patch<Settings>('/settings', patch as Record<string, unknown>));
    if (r !== undefined) {
      setData(r);
      setS(r);
      toast(`Saved ${changed.length} change${changed.length === 1 ? '' : 's'}.`);
    }
  };

  return (
    <>
      <PageHeader
        title="Attendance and pay rules"
        sub="Company-wide rules. An employee's own profile can switch remote work, location and face check on or off just for them."
        actions={
          !ro && (
            <>
              {changed.length > 0 && data && <Button onClick={() => setS(data)}>Undo changes</Button>}
              <Button variant="pri" busy={act.busy} disabled={changed.length === 0 || problems.length > 0} onClick={save}>
                Save{changed.length ? ` (${changed.length})` : ''}
              </Button>
            </>
          )
        }
      />
      {ro && (
        <div style={{ marginBottom: 14 }}>
          <Alert tone="info">Only the owner or Head of HR can change these rules.</Alert>
        </div>
      )}
      <ErrorBox error={act.error} />
      {problems.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <Alert tone="warn">Some values are outside the allowed range (marked in red){problems.includes('meal') ? ', and the meal break must end after it starts' : ''}.</Alert>
        </div>
      )}
      <Async data={s} error={error} loading={loading}>
        {(v) => (
          <>
            <Card title="Working day">
              <Row title="Normal working day" help={`Paid hours in a normal day, not counting the meal break. Hours beyond this are overtime.`}>
                <HoursInput minutes={v.normalDayMinutes} disabled={ro} onChange={(m) => setK('normalDayMinutes', m)} />
                <span className="muted small">hours</span>
              </Row>
              <Row title="Working week" help="Normal hours for each day, for people not on a roster. 0 means a rest day.">
                <div className="row tight" style={{ flexWrap: 'nowrap' }}>
                  {DAYS.map((d, i) => (
                    <label key={d} style={{ display: 'grid', gap: 2, textAlign: 'center' }}>
                      <span className="tiny muted">{d}</span>
                      <HoursInput
                        minutes={v.workWeek[i]}
                        width={58}
                        disabled={ro}
                        onChange={(m) => {
                          const w = [...v.workWeek];
                          w[i] = m;
                          setK('workWeek', w);
                        }}
                      />
                    </label>
                  ))}
                </div>
              </Row>
              <Row title="Meal break" help={`Unpaid break of ${dur(v.mealMinutes)}, taken between the times shown.`}>
                <Input type="number" className="sm right" style={{ width: 70 }} min={0} max={120} disabled={ro} value={v.mealMinutes} onChange={(e) => setK('mealMinutes', Number(e.target.value))} />
                <span className="muted small">min, from</span>
                <Input type="time" className="sm" style={{ width: 110 }} disabled={ro} value={hhmm(v.mealStart)} onChange={(e) => e.target.value && setK('mealStart', parseHhmm(e.target.value))} />
                <span className="muted small">to</span>
                <Input
                  type="time"
                  className="sm"
                  style={{ width: 110, ...(v.mealEnd <= v.mealStart ? { borderColor: 'var(--bad)' } : {}) }}
                  disabled={ro}
                  value={hhmm(v.mealEnd)}
                  onChange={(e) => e.target.value && setK('mealEnd', parseHhmm(e.target.value))}
                />
              </Row>
              <Row title="Grace period" help={`Arriving within this many minutes after the start is not late. ${range('graceMinutes')}`}>
                {num('graceMinutes', { width: 70, suffix: 'min' })}
              </Row>
              <Row title="Smallest overtime counted" help={`Extra time shorter than this is not overtime. ${range('otMinMinutes')}`}>
                {num('otMinMinutes', { width: 70, suffix: 'min' })}
              </Row>
              <Row title="Round overtime down to" help="Overtime is counted in steps of this many minutes.">
                {num('otRoundMinutes', { width: 70, suffix: 'min' })}
              </Row>
              <Row title="Longest working day" help="A roster cannot plan more than this in one day, including overtime.">
                <HoursInput minutes={v.maxDayMinutes} disabled={ro} onChange={(m) => setK('maxDayMinutes', m)} />
                <span className="muted small">hours</span>
              </Row>
              <Row title="Rest between shifts" help="The least time off between the end of one shift and the start of the next.">
                <HoursInput minutes={v.minRestMinutes} disabled={ro} onChange={(m) => setK('minRestMinutes', m)} />
                <span className="muted small">hours</span>
              </Row>
              <Row title="Weekly overtime limit" help="Overtime approvals and rosters are refused above this.">
                <b>{dur(v.weeklyOtCapMinutes)}</b>
                <Chip tone="info">12 hours — fixed by law</Chip>
              </Row>
            </Card>

            <Card title="Attendance capture" sub="Location and face check">
              <Row title="Location needed for attendance" help="The app records where the employee is when they mark in and out.">
                {tog('requireLocation')}
              </Row>
              <Row
                title="Face check"
                help={has('face') ? 'The app takes a selfie and matches it to the employee’s photo at each mark-in.' : 'Part of the Complete plan.'}
              >
                {!has('face') && <Chip>Complete plan</Chip>}
                {tog('requireFace', !has('face'))}
              </Row>
              <Row title="Allow remote work" help="Employees may mark in away from a branch. These mark-ins are labelled Remote.">
                {tog('allowRemote')}
              </Row>
              <Row title="Office mark-ins must be inside the branch fence" help="An office mark-in outside the branch radius is refused (or recorded as remote, if remote work is allowed).">
                {tog('officeMustBeInFence')}
              </Row>
              <Row title="Flag remote mark-ins farther than" help={`Remote mark-ins farther than this from the employee's remote address are flagged for HR. ${range('remoteFlagMeters')}`}>
                {num('remoteFlagMeters', { width: 100, step: 100, suffix: 'metres' })}
              </Row>
              <Row title="Worst GPS accuracy accepted" help={`Positions less accurate than this are refused and the employee is asked to try again. ${range('maxAccuracyM')}`}>
                {num('maxAccuracyM', { width: 90, step: 10, suffix: 'metres' })}
              </Row>
              <Row title="Allow marking in from a web browser" help="Lets employees mark in from the web as well as the app. The app is more reliable for location.">
                {tog('allowWebPunch')}
              </Row>
            </Card>

            <Card title="Overtime and pay">
              <Row title="Overtime rate" help="Of the hourly rate. 150% is the usual rate.">
                {num('otRatePct', { width: 80, suffix: '%' })}
              </Row>
              <Row title="Hourly rate divisor" help={`Hourly rate = monthly basic ÷ this number. ${range('otDivisorHours')}`}>
                {num('otDivisorHours', { width: 80, suffix: 'hours' })}
              </Row>
              <Row title="No-pay day divisor" help={`Daily deduction for a no-pay day = monthly basic ÷ this number. ${range('noPayDivisorDays')}`}>
                {num('noPayDivisorDays', { width: 70, suffix: 'days' })}
              </Row>
              <Row title="An unexplained absence is a no-pay day" help="Off: absences are shown for HR to decide.">
                {tog('absentIsNoPay')}
              </Row>
              <Row title="Pay day" help="Day of the month salaries are paid. Shown in the holiday & pay calendar.">
                {num('payDay', { width: 70, suffix: 'of the month' })}
              </Row>
              <Row title="Release payslips automatically" help="Employees see their payslip in the app as soon as payroll is locked. Off: HR releases them.">
                {tog('autoReleasePayslips')}
              </Row>
            </Card>

            <Card title="Leave year">
              <Row title="Leave year starts in" help="Leave balances reset and carry forward from this month.">
                <Select
                  className="sm"
                  style={{ width: 150 }}
                  disabled={ro}
                  value={String(v.leaveYearStartMonth)}
                  onChange={(e) => setK('leaveYearStartMonth', Number(e.target.value))}
                  options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
                />
              </Row>
            </Card>

            <Card title="Roster">
              <Row title="Rosters need approval" help={has('roster') ? 'A roster week goes to its approver before employees see it.' : 'Rosters are part of the Growth and Complete plans.'}>
                {tog('rosterRequiresApproval')}
              </Row>
            </Card>

            <Card title="Notifications">
              <Row title="Birthday notifications" help="Colleagues get a notice on birthdays. Employees can opt out on their profile; the year is never shown.">
                {tog('birthdayNotifications')}
              </Row>
              <Row title="Tell managers when someone is late" help="The manager gets a notification after the grace period.">
                {tog('notifyManagerOnLate')}
              </Row>
            </Card>

            {!ro && (
              <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
                {changed.length > 0 && <span className="small muted">{changed.length} unsaved change{changed.length === 1 ? '' : 's'}</span>}
                <Button variant="pri" busy={act.busy} disabled={changed.length === 0 || problems.length > 0} onClick={save}>
                  Save
                </Button>
              </div>
            )}
          </>
        )}
      </Async>
    </>
  );
}
