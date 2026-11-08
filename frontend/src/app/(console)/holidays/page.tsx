'use client';

import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { date as fmtDate, today } from '@/lib/format';
import { BranchSelect } from '@/components/pickers';
import { Alert, Async, Button, Card, Chip, Empty, ErrorBox, Field, Input, Modal, PageHeader, Select, Textarea, Toggle, useUi, type Tone } from '@/components/ui';

type Kind = 'POYA' | 'GAZETTED' | 'COMPANY' | 'WEEKLY' | 'CUSTOM';

interface Holiday {
  id: string;
  date: string;
  name: string;
  kind: Kind;
  multiplier: string;
  isPaidOff: boolean;
  branchId: string | null;
  branch: { id: string; name: string } | null;
}

const KINDS: { value: Kind; label: string; tone: Tone; color: string; bg: string }[] = [
  { value: 'POYA', label: 'Poya day', tone: 'warn', color: 'var(--warn)', bg: 'var(--warn-bg)' },
  { value: 'GAZETTED', label: 'Gazetted holiday', tone: 'mag', color: 'var(--magenta)', bg: 'var(--mag-bg)' },
  { value: 'COMPANY', label: 'Company holiday', tone: 'info', color: 'var(--blue)', bg: 'var(--info-bg)' },
  { value: 'WEEKLY', label: 'Weekly holiday', tone: 'ok', color: 'var(--ok)', bg: 'var(--ok-bg)' },
  { value: 'CUSTOM', label: 'Custom', tone: '', color: 'var(--ink-2)', bg: 'var(--card-2)' },
];
const KIND = Object.fromEntries(KINDS.map((k) => [k.value, k])) as Record<Kind, (typeof KINDS)[number]>;
const FALLBACK_MULT: Record<Kind, string> = { POYA: '2.00', GAZETTED: '2.00', COMPANY: '1.50', WEEKLY: '1.50', CUSTOM: '1.00' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const mult = (m: string) => `${Number(m)}×`;

export default function HolidaysPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const { can } = useAuth();
  const thisYear = Number(today().slice(0, 4));
  const [year, setYearState] = useState(Number(sp.get('year')) || thisYear);
  const { data, error, loading, reload } = useApi<Holiday[]>('/holidays', { year });
  const { data: defaults } = useApi<Record<Kind, string>>('/holidays/defaults');
  const [edit, setEdit] = useState<Holiday | 'new' | null>(null);
  const [newDate, setNewDate] = useState<string | null>(null);
  const [bulk, setBulk] = useState(false);
  const act = useAction();
  const { toast, confirm } = useUi();
  const canEdit = can('holiday.edit');
  const defs = defaults ?? FALLBACK_MULT;

  const setYear = (y: number) => {
    setYearState(y);
    router.replace(`/holidays?year=${y}`);
  };

  const remove = async (h: Holiday) => {
    const ok = await confirm({ title: `Delete ${h.name}?`, body: `${fmtDate(h.date, { weekday: true })} will be an ordinary day again. Past days are not recalculated automatically — use “Recalculate day” on the attendance board if needed.`, ok: 'Delete', danger: true });
    if (ok === false) return;
    const r = await act.run(() => api.del(`/holidays/${h.id}`));
    if (r !== undefined) {
      toast('Holiday deleted.');
      reload();
    }
  };

  const copyYear = async () => {
    const ok = await confirm({
      title: `Copy company holidays from ${year - 1}?`,
      body: `Company and weekly holidays from ${year - 1} are added to ${year} on the same day and month. Poya and gazetted dates are not copied — they change every year.`,
      ok: 'Copy',
    });
    if (ok === false) return;
    const r = await act.run(() => api.post<{ created: number }>('/holidays/copy-year', { fromYear: year - 1, toYear: year }));
    if (r !== undefined) {
      toast(r.created ? `${r.created} date${r.created === 1 ? '' : 's'} copied.` : 'Nothing new to copy.');
      reload();
    }
  };

  const openNew = (d?: string) => {
    setNewDate(d ?? null);
    setEdit('new');
  };

  return (
    <>
      <PageHeader
        title="Holiday & pay calendar"
        sub="Dates that change pay. The multiplier drives roster warnings, day close and payroll. A holiday premium is not overtime."
        actions={
          <>
            <div className="row tight">
              <Button size="sm" icon="chev-l" aria-label="Previous year" onClick={() => setYear(year - 1)} />
              <b style={{ minWidth: 48, textAlign: 'center' }}>{year}</b>
              <Button size="sm" icon="chev-r" aria-label="Next year" onClick={() => setYear(year + 1)} />
            </div>
            {canEdit && (
              <>
                <Button icon="copy" busy={act.busy} onClick={copyYear}>
                  Copy company holidays from {year - 1}
                </Button>
                <Button icon="file" onClick={() => setBulk(true)}>
                  Add many
                </Button>
                <Button variant="pri" icon="sun" onClick={() => openNew()}>
                  Add date
                </Button>
              </>
            )}
          </>
        }
      />
      <div style={{ marginBottom: 14 }}>
        <Alert tone="info">
          Poya and gazetted dates change every year and must be entered from the government gazette. Defaults: Poya {mult(defs.POYA)}, gazetted {mult(defs.GAZETTED)}, company {mult(defs.COMPANY)}, weekly {mult(defs.WEEKLY)}. Dates in a month whose payroll is locked cannot change.
        </Alert>
      </div>
      <ErrorBox error={act.error} />
      <Async data={data} error={error} loading={loading}>
        {(rows) => (
          <>
            <Card title={`${year} at a glance`} sub={`${rows.length} date${rows.length === 1 ? '' : 's'}`} actions={<Legend />}>
              <YearGrid year={year} rows={rows} onPick={canEdit ? (d) => {
                const h = rows.find((x) => x.date === d);
                if (h) setEdit(h);
                else openNew(d);
              } : undefined} />
            </Card>
            <Card pad={false} title="All dates">
              {rows.length === 0 ? (
                <Empty title={`No holidays for ${year}`} icon="sun">
                  {canEdit ? 'Add the Poya and gazetted dates from the gazette, or copy company holidays from last year.' : 'HR has not entered the holidays for this year yet.'}
                </Empty>
              ) : (
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Name</th>
                        <th>Kind</th>
                        <th className="num">Pay</th>
                        <th>Paid day off</th>
                        <th>Applies to</th>
                        {canEdit && <th />}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((h) => (
                        <tr key={h.id} style={h.date < today() ? { opacity: 0.7 } : undefined}>
                          <td className="nowrap">{fmtDate(h.date, { weekday: true })}</td>
                          <td>
                            <b>{h.name}</b>
                          </td>
                          <td>
                            <Chip tone={KIND[h.kind].tone}>{KIND[h.kind].label}</Chip>
                          </td>
                          <td className="num">
                            <b>{mult(h.multiplier)}</b>
                          </td>
                          <td>{h.isPaidOff ? 'Yes' : <span className="muted">No</span>}</td>
                          <td>{h.branch ? h.branch.name : <span className="muted">All branches</span>}</td>
                          {canEdit && (
                            <td className="nowrap right">
                              <Button size="sm" variant="ghost" icon="edit" onClick={() => setEdit(h)}>
                                Edit
                              </Button>
                              <Button size="sm" variant="ghost" icon="trash" aria-label="Delete" disabled={act.busy} onClick={() => remove(h)} />
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </Async>

      {edit && (
        <HolidayModal
          holiday={edit === 'new' ? null : edit}
          initialDate={newDate ?? (year === Number(today().slice(0, 4)) ? today() : `${year}-01-01`)}
          defaults={defs}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            reload();
          }}
        />
      )}
      {bulk && <BulkModal year={year} onClose={() => setBulk(false)} onDone={reload} />}
    </>
  );
}

function Legend() {
  return (
    <div className="row tight" style={{ gap: 6 }}>
      {KINDS.map((k) => (
        <span key={k.value} className="row tight tiny muted" style={{ gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: k.bg, border: `1.5px solid ${k.color}`, display: 'inline-block' }} />
          {k.label}
        </span>
      ))}
    </div>
  );
}

function YearGrid({ year, rows, onPick }: { year: number; rows: Holiday[]; onPick?: (d: string) => void }) {
  const byDate = useMemo(() => {
    const m = new Map<string, Holiday[]>();
    for (const h of rows) m.set(h.date, [...(m.get(h.date) ?? []), h]);
    return m;
  }, [rows]);
  const now = today();
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px 18px' }}>
      {MONTHS.map((mName, mi) => {
        const first = new Date(Date.UTC(year, mi, 1));
        const lead = (first.getUTCDay() + 6) % 7; // Monday first
        const days = new Date(Date.UTC(year, mi + 1, 0)).getUTCDate();
        const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
        const monthHols = rows.filter((h) => Number(h.date.slice(5, 7)) === mi + 1);
        return (
          <div key={mName}>
            <div className="row between" style={{ marginBottom: 4 }}>
              <b className="small">{mName}</b>
              {monthHols.length > 0 && <span className="tiny faint">{monthHols.length}</span>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, fontSize: 11 }}>
              {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                <span key={i} className="faint center" style={{ fontWeight: 700, fontSize: 10 }}>
                  {d}
                </span>
              ))}
              {cells.map((n, i) => {
                if (n === null) return <span key={`x${i}`} />;
                const d = `${year}-${String(mi + 1).padStart(2, '0')}-${String(n).padStart(2, '0')}`;
                const hs = byDate.get(d);
                const k = hs ? KIND[hs[0].kind] : null;
                const style = {
                  height: 22,
                  borderRadius: 4,
                  display: 'grid',
                  placeItems: 'center',
                  fontWeight: k ? 700 : 400,
                  background: k ? k.bg : 'transparent',
                  color: k ? k.color : i % 7 >= 5 ? 'var(--ink-3)' : 'var(--ink)',
                  boxShadow: d === now ? 'inset 0 0 0 1.5px var(--blue)' : k ? `inset 0 0 0 1px ${k.color}` : undefined,
                  padding: 0,
                  cursor: onPick ? 'pointer' : 'default',
                };
                const title = hs ? hs.map((h) => `${h.name} · ${mult(h.multiplier)}${h.branch ? ` (${h.branch.name})` : ''}`).join('\n') : fmtDate(d, { weekday: true });
                return onPick ? (
                  <button key={d} type="button" style={style} title={title} onClick={() => onPick(d)}>
                    {n}
                  </button>
                ) : (
                  <span key={d} style={style} title={title}>
                    {n}
                  </span>
                );
              })}
            </div>
            {monthHols.length > 0 && (
              <div style={{ marginTop: 5 }}>
                {monthHols.map((h) => (
                  <div key={h.id} className="tiny" style={{ display: 'flex', gap: 5, alignItems: 'baseline' }}>
                    <b style={{ color: KIND[h.kind].color, minWidth: 16 }}>{Number(h.date.slice(8))}</b>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} className="muted">
                      {h.name}
                    </span>
                    <b>{mult(h.multiplier)}</b>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function HolidayModal({ holiday, initialDate, defaults, onClose, onSaved }: { holiday: Holiday | null; initialDate: string; defaults: Record<Kind, string>; onClose: () => void; onSaved: () => void }) {
  const [day, setDay] = useState(holiday?.date ?? initialDate);
  const [name, setName] = useState(holiday?.name ?? '');
  const [kind, setKind] = useState<Kind>(holiday?.kind ?? 'POYA');
  const [multiplier, setMultiplier] = useState(holiday ? String(Number(holiday.multiplier)) : String(Number(defaults.POYA)));
  const [paidOff, setPaidOff] = useState(holiday?.isPaidOff ?? true);
  const [branchId, setBranchId] = useState(holiday?.branchId ?? '');
  const act = useAction();
  const { toast } = useUi();

  const m = Number(multiplier);
  const multOk = Number.isFinite(m) && m >= 1 && m <= 3;
  const canSave = /^\d{4}-\d{2}-\d{2}$/.test(day) && name.trim().length >= 2 && multOk;

  const changeKind = (k: Kind) => {
    setKind(k);
    setMultiplier(String(Number(defaults[k] ?? FALLBACK_MULT[k])));
    setPaidOff(k !== 'CUSTOM');
  };

  const save = async () => {
    const body = { date: day, name: name.trim(), kind, multiplier: m.toFixed(2), isPaidOff: paidOff, branchId: branchId || null };
    const r = await act.run(() => (holiday ? api.patch(`/holidays/${holiday.id}`, body) : api.post('/holidays', body)));
    if (r !== undefined) {
      toast(holiday ? 'Holiday saved.' : 'Holiday added.');
      onSaved();
    }
  };

  return (
    <Modal
      title={holiday ? 'Edit holiday' : 'Add a holiday'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="pri" busy={act.busy} disabled={!canSave} onClick={save}>
            {holiday ? 'Save' : 'Add holiday'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <ErrorBox error={act.error} />
        <div className="form-grid">
          <Field label="Date" required>
            <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </Field>
          <Field label="Kind" required>
            <Select value={kind} onChange={(e) => changeKind(e.target.value as Kind)} options={KINDS.map((k) => ({ value: k.value, label: k.label }))} />
          </Field>
          <Field label="Name" required wide>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Vesak Full Moon Poya Day" />
          </Field>
          <Field label="Pay multiplier" required hint="Hours worked on this date are paid at this rate (1.0 – 3.0)." error={multiplier && !multOk ? 'Between 1.0 and 3.0.' : null}>
            <Input type="number" min={1} max={3} step={0.5} value={multiplier} onChange={(e) => setMultiplier(e.target.value)} />
          </Field>
          <Field label="Applies to" hint="Leave empty for the whole company.">
            <BranchSelect value={branchId} onChange={setBranchId} placeholder="All branches" />
          </Field>
          <Field label="Paid day off" wide hint="People not rostered get the day off with pay, and it does not count as leave.">
            <Toggle checked={paidOff} onChange={setPaidOff} label={paidOff ? 'Yes — paid day off' : 'No — ordinary working day (premium pay only)'} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

interface ParsedLine {
  line: number;
  item?: { date: string; name: string; kind: Kind; multiplier?: string };
  error?: string;
}

function parseBulk(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const s = raw.trim();
    if (!s || s.startsWith('#')) return;
    const parts = s.split(/[,\t]/).map((p) => p.trim());
    const [d, name, kindRaw, multRaw] = parts;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d ?? '') || Number.isNaN(Date.parse(d))) return out.push({ line: i + 1, error: `Line ${i + 1}: the date must be YYYY-MM-DD.` });
    if (!name || name.length < 2) return out.push({ line: i + 1, error: `Line ${i + 1}: add a name.` });
    const kind = (kindRaw || 'GAZETTED').toUpperCase() as Kind;
    if (!KIND[kind]) return out.push({ line: i + 1, error: `Line ${i + 1}: kind must be POYA, GAZETTED, COMPANY, WEEKLY or CUSTOM.` });
    let multiplier: string | undefined;
    if (multRaw) {
      const m = Number(multRaw.replace(/[x×]/gi, ''));
      if (!(m >= 1 && m <= 3)) return out.push({ line: i + 1, error: `Line ${i + 1}: the multiplier must be between 1 and 3.` });
      multiplier = m.toFixed(2);
    }
    out.push({ line: i + 1, item: { date: d, name: name.slice(0, 80), kind, ...(multiplier ? { multiplier } : {}) } });
  });
  return out;
}

function BulkModal({ year, onClose, onDone }: { year: number; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<{ created: number; skipped: string[] } | null>(null);
  const act = useAction();
  const parsed = parseBulk(text);
  const items = parsed.flatMap((p) => (p.item ? [p.item] : []));
  const errors = parsed.flatMap((p) => (p.error ? [p.error] : []));

  const submit = async () => {
    const r = await act.run(() => api.post<{ created: number; skipped: string[] }>('/holidays/bulk', { items }));
    if (r !== undefined) {
      setResult(r);
      onDone();
    }
  };

  return (
    <Modal
      title="Add many holidays"
      size="wide"
      onClose={onClose}
      footer={
        result ? (
          <Button variant="pri" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="pri" busy={act.busy} disabled={!items.length || errors.length > 0 || items.length > 200} onClick={submit}>
              Add {items.length || ''} date{items.length === 1 ? '' : 's'}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="stack">
          <Alert tone="ok">
            {result.created} date{result.created === 1 ? '' : 's'} added.
          </Alert>
          {result.skipped.length > 0 && (
            <Alert tone="warn">
              {result.skipped.length} skipped:
              <ul>
                {result.skipped.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </Alert>
          )}
        </div>
      ) : (
        <div className="stack">
          <ErrorBox error={act.error} />
          <p className="muted small">
            One date per line: <span className="mono">date, name, kind</span> and optionally a multiplier. Kind is POYA, GAZETTED, COMPANY, WEEKLY or CUSTOM; the multiplier defaults by kind. Dates already in the calendar are skipped. Up to 200 lines.
          </p>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            style={{ minHeight: 220, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13 }}
            placeholder={`${year}-01-13, Duruthu Full Moon Poya Day, POYA\n${year}-02-04, Independence Day, GAZETTED\n${year}-12-25, Christmas Day, GAZETTED\n${year}-12-31, Year-end company holiday, COMPANY, 1.5`}
          />
          {errors.length > 0 && (
            <Alert tone="bad">
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {errors.slice(0, 10).map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
              {errors.length > 10 && <div>…and {errors.length - 10} more.</div>}
            </Alert>
          )}
          {items.length > 0 && errors.length === 0 && (
            <div className="tbl-wrap" style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--rule)', borderRadius: 8 }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Name</th>
                    <th>Kind</th>
                    <th className="num">Pay</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i}>
                      <td className="nowrap">{fmtDate(it.date, { weekday: true })}</td>
                      <td>{it.name}</td>
                      <td>
                        <Chip tone={KIND[it.kind].tone}>{KIND[it.kind].label}</Chip>
                      </td>
                      <td className="num">{it.multiplier ? mult(it.multiplier) : <span className="faint">default</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
