'use client';

/**
 * Pieces shared by the attendance day board and the employee month view:
 * flag labels, mode chip, and the "Add session" modal for HR corrections.
 */

import { useState } from 'react';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { addDays, colomboIso, date as fmtDate, dur, parseHhmm, today } from '@/lib/format';
import { EmployeePicker } from '@/components/pickers';
import { Button, Chip, ErrorBox, Field, Input, Modal, Seg, Textarea, useUi, type Tone } from '@/components/ui';

export type Mode = 'OFFICE' | 'REMOTE';
export type Source = 'APP' | 'WEB' | 'TERMINAL' | 'MANUAL';

export interface Segment {
  start: number;
  end: number;
  mode?: Mode;
}

export interface HolidayInfo {
  name: string;
  kind: 'POYA' | 'GAZETTED' | 'COMPANY' | 'WEEKLY' | 'CUSTOM';
  multiplier: number;
  isPaidOff: boolean;
}

export const FLAG_LABEL: Record<string, { label: string; tone: Tone; title: string }> = {
  FAR_FROM_HOME: { label: 'Far from home', tone: 'warn', title: 'Remote work marked far from the home address' },
  MOCK_LOCATION: { label: 'Fake GPS', tone: 'bad', title: 'The phone reported a mock (fake) location' },
  AUTO_CLOSED: { label: 'Auto-closed', tone: 'warn', title: 'Session closed by the system at day close' },
  MISSING_MARK_OUT: { label: 'No mark-out', tone: 'bad', title: 'The employee did not mark out' },
  CORRECTED: { label: 'Corrected', tone: 'info', title: 'Added or changed by HR or an approved correction' },
  OUTSIDE_FENCE: { label: 'Outside office', tone: 'warn', title: 'Office mark-in outside the branch area' },
  NOT_ROSTERED: { label: 'Not rostered', tone: 'warn', title: 'Worked on a day with no rostered shift' },
  CLOCK_SKEW: { label: 'Phone clock off', tone: 'warn', title: 'The phone clock did not match the server' },
  LATE_SYNC: { label: 'Late sync', tone: '', title: 'Sent from the offline queue some time after the punch' },
  NO_HOME_ADDRESS: { label: 'No home location', tone: '', title: 'Remote work but no home location is saved for this employee' },
};

export function FlagChips({ flags }: { flags: string[] }) {
  if (!flags.length) return <span className="faint">—</span>;
  return (
    <span className="row tight" style={{ gap: 4 }}>
      {flags.map((f) => {
        const l = FLAG_LABEL[f];
        return (
          <Chip key={f} tone={l?.tone ?? 'warn'} title={l?.title}>
            {l?.label ?? f.toLowerCase().replace(/_/g, ' ')}
          </Chip>
        );
      })}
    </span>
  );
}

export function ModeChip({ mode }: { mode: Mode }) {
  return <Chip tone={mode === 'REMOTE' ? 'mag' : 'info'}>{mode === 'REMOTE' ? 'Remote' : 'Office'}</Chip>;
}

export const SOURCE_LABEL: Record<Source, string> = { APP: 'App', WEB: 'Web', TERMINAL: 'Terminal', MANUAL: 'Manual (HR)' };

export function LeaveChip({ leave }: { leave: { type: string; color: string; halfDay: string | null } }) {
  return (
    <span className="chip" style={{ background: leave.color + '22', color: leave.color }}>
      {leave.type}
      {leave.halfDay ? ` (${leave.halfDay})` : ''}
    </span>
  );
}

export function HolidayChip({ h }: { h: HolidayInfo }) {
  return (
    <Chip tone="mag" title={`${h.kind.toLowerCase()} holiday${h.isPaidOff ? ', paid day off' : ''}`}>
      {h.name} · {h.multiplier}×
    </Chip>
  );
}

/** "08:30–17:30" style text for roster segments; a block ending at 24:00 is shown as 24:00. */
export function segText(s: Segment): string {
  const f = (m: number) => (m === 1440 ? '24:00' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  return `${f(s.start)}–${f(s.end)}`;
}

/** HR adds a missing session (manual, flagged CORRECTED). */
export function AddSessionModal({ employeeId, employeeName, defaultDate, onClose, onSaved }: { employeeId?: string; employeeName?: string; defaultDate?: string; onClose: () => void; onSaved: () => void }) {
  const [emp, setEmp] = useState<string | null>(employeeId ?? null);
  const [day, setDay] = useState(defaultDate ?? today());
  const [start, setStart] = useState('08:30');
  const [end, setEnd] = useState('17:30');
  const [mode, setMode] = useState<Mode>('OFFICE');
  const [reason, setReason] = useState('');
  const act = useAction();
  const { toast } = useUi();

  const valid = /^\d{2}:\d{2}$/.test(start) && /^\d{2}:\d{2}$/.test(end);
  const s = valid ? parseHhmm(start) : 0;
  const e = valid ? parseHhmm(end) : 0;
  const nextDay = valid && e <= s;
  const minutes = valid ? (nextDay ? e + 1440 - s : e - s) : 0;
  const tooLong = minutes > 16 * 60;
  const canSave = !!emp && !!day && valid && minutes > 0 && !tooLong && reason.trim().length >= 5;

  const save = async () => {
    if (!emp) return;
    const body = {
      employeeId: emp,
      date: day,
      start: colomboIso(day, start),
      end: colomboIso(nextDay ? addDays(day, 1) : day, end),
      mode,
      reason: reason.trim(),
    };
    const r = await act.run(() => api.post('/attendance/sessions', body));
    if (r !== undefined) {
      toast('Session added. The day totals are updated.');
      onSaved();
      onClose();
    }
  };

  return (
    <Modal
      title="Add a session"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="pri" busy={act.busy} disabled={!canSave} onClick={save}>
            Add session
          </Button>
        </>
      }
    >
      <div className="stack">
        <ErrorBox error={act.error} />
        <div className="form-grid">
          <Field label="Employee" required wide>
            {employeeId ? <Input value={employeeName ?? ''} disabled /> : <EmployeePicker value={emp} onChange={(id) => setEmp(id)} />}
          </Field>
          <Field label="Date" required>
            <Input type="date" value={day} max={today()} onChange={(ev) => setDay(ev.target.value)} />
          </Field>
          <Field label="Where">
            <Seg<Mode>
              value={mode}
              onChange={setMode}
              options={[
                { value: 'OFFICE', label: 'Office' },
                { value: 'REMOTE', label: 'Remote' },
              ]}
            />
          </Field>
          <Field label="Start" required>
            <Input type="time" value={start} onChange={(ev) => setStart(ev.target.value)} />
          </Field>
          <Field label="End" required hint={nextDay ? `Ends the next day (${fmtDate(addDays(day, 1), { weekday: true, year: false })}).` : 'An end earlier than the start means the next day.'} error={tooLong ? 'A session cannot be longer than 16 hours.' : null}>
            <Input type="time" value={end} onChange={(ev) => setEnd(ev.target.value)} />
          </Field>
          <Field label="Reason" required wide hint="Kept in the audit log. At least 5 characters.">
            <Textarea value={reason} placeholder="e.g. Forgot to mark in; confirmed by the supervisor" onChange={(ev) => setReason(ev.target.value)} />
          </Field>
        </div>
        {valid && minutes > 0 && !tooLong && (
          <div className="muted small">
            Session length: <b>{dur(minutes)}</b>. The meal hour is deducted only if this one session covers 12:00–13:00. A session past midnight is split into the next date.
          </div>
        )}
      </div>
    </Modal>
  );
}
