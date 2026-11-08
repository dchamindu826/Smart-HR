'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { dur, hhmm, parseHhmm } from '@/lib/format';
import { Async, Button, Card, Chip, Empty, ErrorBox, Field, Input, Modal, PageHeader, StatusChip, Toggle, useUi } from '@/components/ui';

interface Pattern {
  id: string;
  code: string;
  name: string;
  segments: { start: number; end: number }[]; // end may be > 1440 (crosses midnight)
  totalMinutes: number;
  color: string;
  active: boolean;
  _count: { employees: number };
}

interface BlockRow {
  start: string;
  end: string;
}

const MEAL_START = 720;
const MEAL_END = 780;
const MEAL = 60;
const NORMAL_DAY = 480;

/** End of a stored segment as a clock time; flags a past-midnight end. */
function endText(end: number): string {
  if (end === 1440) return '24:00';
  return end > 1440 ? `${hhmm(end - 1440)} (+1)` : hhmm(end);
}

/** Typed blocks → normalised minutes (end ≤ start = next day). */
function normalise(rows: BlockRow[]): { start: number; end: number }[] | null {
  const out: { start: number; end: number }[] = [];
  for (const r of rows) {
    if (!/^\d{2}:\d{2}$/.test(r.start) || !/^\d{2}:\d{2}$/.test(r.end)) return null;
    const s = parseHhmm(r.start);
    const e = parseHhmm(r.end);
    out.push({ start: s, end: e > s ? e : e + 1440 });
  }
  return out;
}

function planOf(blocks: { start: number; end: number }[]) {
  const total = blocks.reduce((a, b) => a + (b.end - b.start), 0);
  const meal = blocks.some((b) => b.start <= MEAL_START && b.end >= MEAL_END) ? MEAL : 0;
  const paid = Math.max(0, total - meal);
  return { total, meal, paid, ot: Math.max(0, paid - NORMAL_DAY) };
}

export default function ShiftsPage() {
  const { can } = useAuth();
  const { data, error, loading, reload } = useApi<Pattern[]>('/shifts');
  const [edit, setEdit] = useState<Pattern | 'new' | null>(null);
  const act = useAction();
  const { toast, confirm } = useUi();
  const canEdit = can('shift.edit');

  const remove = async (p: Pattern) => {
    const ok = await confirm({ title: `Delete ${p.name}?`, body: 'A shift that is used by employees or rosters cannot be deleted — make it inactive instead.', ok: 'Delete', danger: true });
    if (ok === false) return;
    const r = await act.run(() => api.del(`/shifts/${p.id}`));
    if (r !== undefined) {
      toast('Shift deleted.');
      reload();
    }
  };

  return (
    <>
      <PageHeader
        title="Shift patterns"
        sub="Ready-made shifts the roster maker can drop into a day. A normal day is 9 hours including a 1-hour meal = 8 paid hours; paid time above that is planned overtime. A split shift has two or more blocks; a night shift runs past midnight and is split into the next date."
        actions={
          canEdit && (
            <Button variant="pri" icon="layers" onClick={() => setEdit('new')}>
              Add shift
            </Button>
          )
        }
      />
      <ErrorBox error={act.error} />
      <Async data={data} error={error} loading={loading}>
        {(rows) =>
          rows.length === 0 ? (
            <Card>
              <Empty
                title="No shift patterns yet"
                icon="layers"
                action={
                  canEdit && (
                    <Button variant="pri" onClick={() => setEdit('new')}>
                      Add the first shift
                    </Button>
                  )
                }
              >
                For example: Day 08:30–17:30, Night 22:00–06:00, or a split shift 07:00–11:00 + 16:00–20:00.
              </Empty>
            </Card>
          ) : (
            <Card pad={false}>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Shift</th>
                      <th>Time blocks</th>
                      <th className="num">Total</th>
                      <th className="num">Paid</th>
                      <th>Type</th>
                      <th className="num">Employees</th>
                      <th>Status</th>
                      {canEdit && <th />}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => {
                      const plan = planOf(p.segments);
                      const night = p.segments.some((s) => s.end > 1440);
                      const split = p.segments.length > 1;
                      return (
                        <tr key={p.id} style={p.active ? undefined : { opacity: 0.6 }}>
                          <td>
                            <div className="row tight">
                              <span className="shift-pill" style={{ background: p.color }}>
                                {p.code}
                              </span>
                              <b>{p.name}</b>
                            </div>
                          </td>
                          <td className="nowrap">
                            {p.segments.map((s, i) => (
                              <span key={i}>
                                {i > 0 && <span className="faint"> + </span>}
                                {hhmm(s.start)}–{endText(s.end)}
                              </span>
                            ))}
                          </td>
                          <td className="num">{dur(p.totalMinutes)}</td>
                          <td className="num">
                            {dur(plan.paid)}
                            {plan.ot > 0 && <div className="tiny warn-t">{dur(plan.ot)} planned OT</div>}
                          </td>
                          <td>
                            <div className="row tight" style={{ gap: 4 }}>
                              {night && <Chip tone="info">Night (crosses midnight)</Chip>}
                              {split && <Chip tone="mag">Split shift</Chip>}
                              {!night && !split && <span className="faint">Day</span>}
                            </div>
                          </td>
                          <td className="num">{p._count.employees}</td>
                          <td>
                            <StatusChip status={p.active ? 'ACTIVE' : 'RETIRED'} labelText={p.active ? 'Active' : 'Inactive'} />
                          </td>
                          {canEdit && (
                            <td className="nowrap right">
                              <Button size="sm" variant="ghost" icon="edit" onClick={() => setEdit(p)}>
                                Edit
                              </Button>
                              <Button size="sm" variant="ghost" icon="trash" disabled={act.busy} onClick={() => remove(p)} aria-label="Delete" />
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )
        }
      </Async>
      {edit && (
        <PatternModal
          pattern={edit === 'new' ? null : edit}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            reload();
          }}
        />
      )}
    </>
  );
}

function PatternModal({ pattern, onClose, onSaved }: { pattern: Pattern | null; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState(pattern?.code ?? '');
  const [name, setName] = useState(pattern?.name ?? '');
  const [color, setColor] = useState(pattern?.color ?? '#0B6FD4');
  const [active, setActive] = useState(pattern?.active ?? true);
  const [blocks, setBlocks] = useState<BlockRow[]>(
    pattern ? pattern.segments.map((s) => ({ start: hhmm(s.start), end: hhmm(s.end >= 1440 ? s.end - 1440 : s.end) })) : [{ start: '08:30', end: '17:30' }],
  );
  const act = useAction();
  const { toast } = useUi();

  const norm = normalise(blocks);
  const sorted = norm ? [...norm].sort((a, b) => a.start - b.start) : null;
  const overlap = !!sorted && sorted.some((b, i) => i > 0 && b.start < sorted[i - 1].end);
  const plan = norm ? planOf(norm) : null;
  const tooLong = !!plan && plan.total > 16 * 60;
  const codeOk = /^[A-Za-z0-9_-]{1,10}$/.test(code.trim());
  const canSave = codeOk && name.trim().length >= 2 && !!norm && !overlap && !tooLong && (plan?.total ?? 0) > 0;

  const setBlock = (i: number, k: keyof BlockRow, v: string) => setBlocks((b) => b.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  const save = async () => {
    if (!norm) return;
    const body = {
      code: code.trim(),
      name: name.trim(),
      color,
      active,
      // typed minutes; an end at or before the start means past midnight
      blocks: blocks.map((b) => ({ start: parseHhmm(b.start), end: parseHhmm(b.end) })),
    };
    const r = await act.run(() => (pattern ? api.patch(`/shifts/${pattern.id}`, body) : api.post('/shifts', body)));
    if (r !== undefined) {
      toast(pattern ? 'Shift saved.' : 'Shift added.');
      onSaved();
    }
  };

  return (
    <Modal
      title={pattern ? `Edit ${pattern.name}` : 'Add a shift pattern'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="pri" busy={act.busy} disabled={!canSave} onClick={save}>
            {pattern ? 'Save shift' : 'Add shift'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <ErrorBox error={act.error} />
        <div className="form-grid">
          <Field label="Code" required hint="Short, shown in the roster grid (e.g. D, N, SPLIT)." error={code && !codeOk ? 'Letters, numbers, - and _ only (max 10).' : null}>
            <Input value={code} maxLength={10} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="D" />
          </Field>
          <Field label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Day shift" />
          </Field>
          <Field label="Colour">
            <div className="row tight">
              <input type="color" value={color} onChange={(e) => setColor(e.target.value.toUpperCase())} style={{ width: 44, height: 36, border: '1px solid var(--rule-2)', borderRadius: 7, background: 'var(--card)', padding: 2 }} />
              <span className="shift-pill" style={{ background: color }}>
                {code || 'CODE'}
              </span>
            </div>
          </Field>
          {pattern && (
            <Field label="Status">
              <Toggle checked={active} onChange={setActive} label={active ? 'Active' : 'Inactive'} />
            </Field>
          )}
        </div>

        <div>
          <div className="row between" style={{ marginBottom: 6 }}>
            <b className="small">Time blocks</b>
            <Button size="xs" icon="plus-clock" disabled={blocks.length >= 4} onClick={() => setBlocks((b) => [...b, { start: '16:00', end: '20:00' }])}>
              Add block
            </Button>
          </div>
          <div className="stack tight">
            {blocks.map((b, i) => (
              <div className="row tight" key={i}>
                <span className="muted small" style={{ width: 54 }}>
                  Block {i + 1}
                </span>
                <Input type="time" value={b.start} onChange={(e) => setBlock(i, 'start', e.target.value)} style={{ width: 130 }} />
                <span className="faint">to</span>
                <Input type="time" value={b.end} onChange={(e) => setBlock(i, 'end', e.target.value)} style={{ width: 130 }} />
                {norm && norm[i] && norm[i].end > 1440 && <Chip tone="info">next day</Chip>}
                {blocks.length > 1 && <Button size="xs" variant="ghost" icon="x" aria-label="Remove block" onClick={() => setBlocks((x) => x.filter((_, j) => j !== i))} />}
              </div>
            ))}
          </div>
          <p className="tiny faint" style={{ marginTop: 6 }}>
            An end time earlier than the start means the block continues past midnight into the next day (e.g. 22:00 to 06:00). Two or more blocks make a split shift.
          </p>
        </div>

        {plan && (
          <div className="alert info">
            <div>
              Total <b>{dur(plan.total)}</b>
              {plan.meal > 0 ? <> − meal {dur(plan.meal)}</> : <> (no meal deduction — no single block covers 12:00–13:00)</>} = paid <b>{dur(plan.paid)}</b>
              {plan.ot > 0 && <> · {dur(plan.ot)} planned overtime per day</>}
            </div>
          </div>
        )}
        {overlap && <div className="alert bad">Time blocks overlap.</div>}
        {tooLong && <div className="alert bad">A shift cannot be longer than 16 hours.</div>}
      </div>
    </Modal>
  );
}
