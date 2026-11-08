'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, errorMessage, qs } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { addDays, date as fmtDate, dur, hhmm, mondayOf, parseHhmm, today } from '@/lib/format';
import { UserSelect } from '@/components/pickers';
import { Alert, Async, Button, Card, Check, Chip, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, Progress, Select, Seg, StatusChip, Tabs, Toggle, useUi } from '@/components/ui';

// ─── types ────────────────────────────────────────────────────

type Mode = 'OFFICE' | 'REMOTE';
type RosterStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'PUBLISHED' | 'RETURNED';

interface Segment {
  start: number;
  end: number;
  mode?: Mode;
}

interface Pattern {
  id: string;
  code: string;
  name: string;
  segments: { start: number; end: number }[]; // end may be > 1440
  totalMinutes: number;
  color: string;
  active: boolean;
}

interface Group {
  id: string;
  name: string;
  makerId: string;
  approverId: string | null;
  active: boolean;
  maker: { id: string; name: string; role: string };
  approver: { id: string; name: string } | null;
  members: { id: string; empNo: string; firstName: string; lastName: string; designation: string | null }[];
  weeks: { id: string; weekStart: string; status: RosterStatus; revision: number }[];
}

interface Member {
  id: string;
  empNo: string;
  firstName: string;
  lastName: string;
  designation: string | null;
  branchId: string | null;
  defaultShiftPatternId: string | null;
}

interface RDay {
  id: string;
  employeeId: string;
  date: string;
  shiftPatternId: string | null;
  segments: Segment[];
  isOff: boolean;
  totalMinutes: number;
  paidMinutes: number;
  plannedOtMinutes: number;
  note: string | null;
}

interface DayPlan {
  totalMinutes: number;
  mealMinutes: number;
  paidMinutes: number;
  plannedOtMinutes: number;
}

interface Issue {
  level: 'error' | 'warning';
  code: string;
  employeeId: string;
  date?: string;
  message: string;
}

interface WeekData {
  group: { id: string; name: string; maker: { id: string; name: string }; approverId: string | null };
  access: { canView: boolean; canEdit: boolean; canApprove: boolean };
  weekStart: string;
  week: null | { id: string; weekStart: string; revision: number; status: RosterStatus; preparedById: string | null; submittedAt: string | null; decidedAt: string | null; publishedAt: string | null; note: string | null };
  publishedRevision: number | null;
  members: Member[];
  days: RDay[];
  holidays: Record<string, { name: string; kind: string; multiplier: number; isPaidOff: boolean }>;
  leave: { employeeId: string; fromDate: string; toDate: string; status: 'APPROVED' | 'PENDING'; halfDay: string | null; leaveType: { name: string; color: string } }[];
  approvedOt: Record<string, number>;
  check: { issues: Issue[]; days: Record<string, Record<string, DayPlan>>; weeklyOt: Record<string, number> };
}

interface Emp {
  id: string;
  empNo: string;
  firstName: string;
  lastName: string;
  designation: string | null;
  department?: { name: string } | null;
}

type Target = { employeeId: string; date: string };
type TabKey = 'week' | 'groups';

// ─── rules for the live preview only (the backend decides) ────

const NORMAL_DAY = 480;
const MEAL = 60;
const MEAL_START = 720;
const MEAL_END = 780;
const WEEKLY_CAP = 720;
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function planDay(blocks: { start: number; end: number }[]): DayPlan {
  const s = blocks.filter((b) => b.end > b.start).sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const b of s) {
    const last = merged[merged.length - 1];
    if (last && b.start <= last.end) last.end = Math.max(last.end, b.end);
    else merged.push({ ...b });
  }
  const total = merged.reduce((a, b) => a + (b.end - b.start), 0);
  if (!total) return { totalMinutes: 0, mealMinutes: 0, paidMinutes: 0, plannedOtMinutes: 0 };
  const meal = merged.some((b) => b.start <= MEAL_START && b.end >= MEAL_END) ? MEAL : 0;
  const paid = Math.max(0, total - meal);
  return { totalMinutes: total, mealMinutes: meal, paidMinutes: paid, plannedOtMinutes: Math.max(0, paid - NORMAL_DAY) };
}

const t24 = (m: number) => (m === 1440 ? '24:00' : hhmm(m));
const key = (e: string, d: string) => `${e}|${d}`;
const hours = (m: number) => `${Math.round(m / 6) / 10} h`;
const fullName = (m: { firstName: string; lastName: string }) => `${m.firstName} ${m.lastName}`;

/** Helpers over one loaded week. */
function weekTools(data: WeekData) {
  const map = new Map(data.days.map((d) => [key(d.employeeId, d.date), d]));
  const segsOf = (e: string, d: string) => [...(map.get(key(e, d))?.segments ?? [])].sort((a, b) => a.start - b.start);
  /** Blocks on `d` that are the tail of the previous night's shift (only within this week). */
  const carryIn = (e: string, d: string): Segment[] => {
    if (d <= data.weekStart) return [];
    const prev = segsOf(e, addDays(d, -1));
    if (!prev.some((s) => s.end === 1440)) return [];
    return segsOf(e, d).filter((s) => s.start === 0);
  };
  /** The day's own blocks, as the maker typed them (a night block shows its real end). */
  const own = (e: string, d: string): { start: number; end: number; mode: Mode; nextDay: boolean }[] => {
    const carry = carryIn(e, d);
    return segsOf(e, d)
      .filter((s) => !carry.includes(s))
      .map((s) => {
        if (s.end === 1440) {
          const tail = segsOf(e, addDays(d, 1)).find((x) => x.start === 0);
          return { start: s.start, end: tail ? tail.end : 0, mode: s.mode ?? 'OFFICE', nextDay: true };
        }
        return { start: s.start, end: s.end, mode: s.mode ?? 'OFFICE', nextDay: false };
      });
  };
  return { map, carryIn, own };
}

// ─── page ─────────────────────────────────────────────────────

export default function RosterPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const { can } = useAuth();
  const canGroups = can('roster.groups');
  const [tab, setTab] = useState<TabKey>(sp.get('tab') === 'groups' && canGroups ? 'groups' : 'week');
  const [groupId, setGroupId] = useState(sp.get('group') ?? '');
  const w0 = sp.get('week');
  const [week, setWeek] = useState(mondayOf(w0 && /^\d{4}-\d{2}-\d{2}$/.test(w0) ? w0 : today()));
  const groups = useApi<Group[]>('/roster/groups');

  const active = (groups.data ?? []).filter((g) => g.active);
  const current = active.find((g) => g.id === groupId)?.id ?? active[0]?.id ?? '';

  useEffect(() => {
    if (!groups.data) return;
    router.replace(`/roster${qs({ tab: tab === 'groups' ? 'groups' : undefined, group: current || undefined, week })}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, current, week, !!groups.data]);

  return (
    <>
      <PageHeader
        title="Roster"
        sub="Plan each week's shifts. A normal day is 9 hours including a 1-hour meal = 8 paid hours; paid time above that is planned overtime. At least one rest day a week and no more than 12 hours overtime a week — these are legal limits."
      />
      {canGroups && (
        <Tabs<TabKey>
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'week', label: 'Weekly roster' },
            { value: 'groups', label: 'Roster groups', count: active.length },
          ]}
        />
      )}
      <Async data={groups.data} error={groups.error} loading={groups.loading}>
        {(all) =>
          tab === 'groups' && canGroups ? (
            <GroupsTab
              groups={all}
              reload={groups.reload}
              onOpen={(g, w) => {
                setGroupId(g);
                if (w) setWeek(w);
                setTab('week');
              }}
            />
          ) : active.length === 0 ? (
            <Card>
              <Empty
                title="No roster groups yet"
                icon="grid"
                action={
                  canGroups && (
                    <Button variant="pri" onClick={() => setTab('groups')}>
                      Create a roster group
                    </Button>
                  )
                }
              >
                {canGroups ? 'HR decides who makes each roster. Create a group with a maker and its members first.' : 'HR has not made you the maker or approver of a roster group yet.'}
              </Empty>
            </Card>
          ) : (
            <WeekRoster groups={active} groupId={current} setGroupId={setGroupId} week={week} setWeek={setWeek} onChanged={groups.reload} />
          )
        }
      </Async>
    </>
  );
}

// ─── weekly roster ────────────────────────────────────────────

function WeekRoster({ groups, groupId, setGroupId, week, setWeek, onChanged }: { groups: Group[]; groupId: string; setGroupId: (v: string) => void; week: string; setWeek: (v: string) => void; onChanged: () => void }) {
  const base = `/roster/groups/${groupId}/weeks/${week}`;
  const { data, error, loading, reload, setData } = useApi<WeekData>(groupId ? base : null);
  const { data: patterns } = useApi<Pattern[]>('/shifts');
  const act = useAction();
  const { toast, confirm } = useUi();
  const [editing, setEditing] = useState<Target[] | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<Target[]>([]);
  const thisWeek = mondayOf(today());
  const group = groups.find((g) => g.id === groupId);

  useEffect(() => {
    setSel([]);
    setSelecting(false);
  }, [groupId, week]);

  const post = async (path: string, msg: string, body?: Record<string, unknown>, returnsWeek = false) => {
    const r = await act.run(() => api.post<WeekData>(`${base}/${path}`, body));
    if (r === undefined) return;
    toast(msg);
    if (returnsWeek) setData(r);
    else reload();
    onChanged();
  };

  const submit = () => post('submit', 'Roster sent for approval.');
  const approve = async () => {
    if ((await confirm({ title: 'Approve this roster?', body: 'The maker (or you) can then publish it to the team.', ok: 'Approve' })) === false) return;
    post('decide', 'Roster approved.', { approve: true });
  };
  const sendBack = async () => {
    const note = await confirm({ title: 'Return to the maker?', body: 'Say what needs to change. The maker sees this note.', ok: 'Return roster', danger: true, input: { label: 'What needs to change', minLength: 5 } });
    if (note === false) return;
    post('decide', 'Roster returned to the maker.', { approve: false, note });
  };
  const publish = async () => {
    if ((await confirm({ title: 'Publish this roster?', body: 'Everyone in the group sees it in the app and is notified. After publishing, changes are made through a new revision that needs approval again.', ok: 'Publish' })) === false) return;
    post('publish', 'Roster published to the team.');
  };
  const withdraw = () => post('withdraw', 'Roster withdrawn. You can edit it again.');
  const fill = () => post('fill', 'Empty days filled from default shifts.', undefined, true);
  const copyPrev = async () => {
    if ((await confirm({ title: 'Copy the previous week?', body: 'Every day of last week is copied to this week, overwriting what is here.', ok: 'Copy week' })) === false) return;
    post('copy-previous', 'Previous week copied.', undefined, true);
  };

  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <Select value={groupId} onChange={(e) => setGroupId(e.target.value)} options={groups.map((g) => ({ value: g.id, label: g.name }))} style={{ width: 220 }} />
        <div className="row tight">
          <Button size="sm" icon="chev-l" aria-label="Previous week" onClick={() => setWeek(addDays(week, -7))} />
          <b style={{ minWidth: 190, textAlign: 'center' }}>
            {fmtDate(week, { year: false })} – {fmtDate(addDays(week, 6))}
          </b>
          <Button size="sm" icon="chev-r" aria-label="Next week" onClick={() => setWeek(addDays(week, 7))} />
          <Button size="sm" disabled={week === thisWeek} onClick={() => setWeek(thisWeek)}>
            This week
          </Button>
          <Input type="date" value={week} onChange={(e) => e.target.value && setWeek(mondayOf(e.target.value))} style={{ width: 150 }} aria-label="Go to week" />
        </div>
      </div>
      <ErrorBox error={act.error} />
      <Async data={data} error={error} loading={loading}>
        {(d) => {
          const status = d.week?.status ?? null;
          const editable = d.access.canEdit && status !== 'SUBMITTED';
          const startable = status === null || status === 'DRAFT' || status === 'RETURNED';
          const errors = d.check.issues.filter((i) => i.level === 'error');
          const busy = act.busy;
          return (
            <>
              <Card>
                <div className="row between">
                  <div className="row">
                    {d.week ? <StatusChip status={d.week.status} /> : <Chip>Not started</Chip>}
                    {d.week && <span className="small muted">Revision {d.week.revision}</span>}
                    <span className="small muted">
                      Maker <b>{d.group.maker.name}</b> · approver <b>{group?.approver?.name ?? 'Head of HR'}</b>
                    </span>
                    {d.publishedRevision !== null && d.week && d.week.status !== 'PUBLISHED' && <Chip tone="ok">Revision {d.publishedRevision} is live until this one is published</Chip>}
                  </div>
                  <div className="row tight">
                    {d.access.canEdit && startable && (
                      <>
                        <Button size="sm" icon="layers" busy={busy} onClick={fill}>
                          Fill from default shifts
                        </Button>
                        <Button size="sm" icon="copy" disabled={busy} onClick={copyPrev}>
                          Copy previous week
                        </Button>
                      </>
                    )}
                    {editable && (
                      <Button size="sm" variant={selecting ? 'pri' : ''} icon="check" onClick={() => (selecting ? (setSelecting(false), setSel([])) : setSelecting(true))}>
                        {selecting ? 'Stop selecting' : 'Select several days'}
                      </Button>
                    )}
                    {d.access.canEdit && (status === 'DRAFT' || status === 'RETURNED') && (
                      <Button size="sm" variant="pri" icon="send" disabled={busy || errors.length > 0 || d.days.length === 0} title={errors.length ? 'Fix the problems in red first' : undefined} onClick={submit}>
                        Submit for approval
                      </Button>
                    )}
                    {status === 'SUBMITTED' && d.access.canEdit && (
                      <Button size="sm" disabled={busy} onClick={withdraw}>
                        Withdraw
                      </Button>
                    )}
                    {status === 'SUBMITTED' && d.access.canApprove && (
                      <>
                        <Button size="sm" variant="danger" disabled={busy} onClick={sendBack}>
                          Return with note
                        </Button>
                        <Button size="sm" variant="ok" disabled={busy || errors.length > 0} title={errors.length ? 'This roster breaks a rule; return it to the maker' : undefined} onClick={approve}>
                          Approve
                        </Button>
                      </>
                    )}
                    {status === 'APPROVED' && (d.access.canEdit || d.access.canApprove) && (
                      <Button size="sm" variant="grad" icon="send" disabled={busy} onClick={publish}>
                        Publish
                      </Button>
                    )}
                  </div>
                </div>
                {status === 'RETURNED' && d.week?.note && (
                  <div style={{ marginTop: 12 }}>
                    <Alert tone="warn">
                      <b>Returned:</b> {d.week.note}
                    </Alert>
                  </div>
                )}
                {status === 'SUBMITTED' && (
                  <div style={{ marginTop: 12 }}>
                    <Alert tone="info">Waiting for approval. The week is locked{d.access.canEdit ? ' — withdraw it to make changes' : ''}.</Alert>
                  </div>
                )}
                {(status === 'PUBLISHED' || status === 'APPROVED') && d.access.canEdit && (
                  <p className="tiny muted" style={{ marginTop: 10 }}>
                    Any change you make now starts revision {(d.week?.revision ?? 0) + 1}, which must be submitted and approved again. The current {status === 'PUBLISHED' ? 'published' : 'approved'} version stays in force until then.
                  </p>
                )}
              </Card>

              {d.members.length === 0 ? (
                <Card>
                  <Empty title="This group has no members" icon="users">
                    Add employees to the group on the Roster groups tab.
                  </Empty>
                </Card>
              ) : (
                <Card pad={false}>
                  {selecting && (
                    <div className="filters">
                      <span className="small">
                        {sel.length ? `${sel.length} day${sel.length === 1 ? '' : 's'} selected` : 'Click days to select them, then edit them together.'}
                      </span>
                      <Button size="sm" variant="pri" disabled={!sel.length} onClick={() => setEditing(sel)}>
                        Edit selected
                      </Button>
                      <Button size="sm" variant="ghost" disabled={!sel.length} onClick={() => setSel([])}>
                        Clear
                      </Button>
                    </div>
                  )}
                  <Grid
                    data={d}
                    patterns={patterns ?? []}
                    editable={editable}
                    selected={sel}
                    onCell={(t) => {
                      if (!editable) return;
                      if (selecting) setSel((s) => (s.some((x) => x.employeeId === t.employeeId && x.date === t.date) ? s.filter((x) => !(x.employeeId === t.employeeId && x.date === t.date)) : [...s, t]));
                      else setEditing([t]);
                    }}
                  />
                  <p className="tiny faint" style={{ padding: '8px 14px' }}>
                    R = remote block. ↳ = the end of the previous night&apos;s shift. A night shift is split at midnight and counted on both dates. Striped = rest day; magenta line = holiday; red outline = breaks a rule.
                  </p>
                </Card>
              )}

              <IssuesPanel data={d} onOpen={editable ? (t) => setEditing([t]) : undefined} />

              {editing && (
                <CellEditor
                  data={d}
                  base={base}
                  targets={editing}
                  patterns={(patterns ?? []).filter((p) => p.active)}
                  onClose={() => setEditing(null)}
                  onSaved={(r) => {
                    const wasLive = status === 'PUBLISHED' || status === 'APPROVED';
                    setData(r);
                    setEditing(null);
                    setSel([]);
                    setSelecting(false);
                    toast(wasLive && r.week ? `Saved as revision ${r.week.revision}. Submit it for approval to publish the change.` : 'Saved.');
                    onChanged();
                  }}
                />
              )}
            </>
          );
        }}
      </Async>
    </>
  );
}

function Grid({ data, patterns, editable, selected, onCell }: { data: WeekData; patterns: Pattern[]; editable: boolean; selected: Target[]; onCell: (t: Target) => void }) {
  const dates = Array.from({ length: 7 }, (_, i) => addDays(data.weekStart, i));
  const tools = useMemo(() => weekTools(data), [data]);
  const pmap = useMemo(() => new Map(patterns.map((p) => [p.id, p])), [patterns]);
  const now = today();
  return (
    <div className="tbl-wrap">
      <table className="rgrid">
        <thead>
          <tr>
            <th style={{ textAlign: 'left', left: 0, zIndex: 3 }}>Employee</th>
            {dates.map((d, i) => {
              const h = data.holidays[d];
              return (
                <th key={d} style={{ minWidth: 112, textAlign: 'left', ...(d === now ? { boxShadow: 'inset 0 -2px 0 var(--blue)' } : {}) }}>
                  <div>
                    {DOW[i]} {Number(d.slice(8))}
                  </div>
                  {h && (
                    <div className="tiny" style={{ color: 'var(--magenta)', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 130 }} title={h.name}>
                      {h.name} · {h.multiplier}×
                    </div>
                  )}
                </th>
              );
            })}
            <th style={{ minWidth: 130, textAlign: 'left' }}>Planned OT</th>
          </tr>
        </thead>
        <tbody>
          {data.members.map((m) => {
            const weekOt = data.check.weeklyOt[m.id] ?? 0;
            const approved = data.approvedOt[m.id] ?? 0;
            const totalOt = weekOt + approved;
            const def = m.defaultShiftPatternId ? pmap.get(m.defaultShiftPatternId) : undefined;
            return (
              <tr key={m.id}>
                <td className="name">
                  <b style={{ display: 'block', lineHeight: 1.25 }}>{fullName(m)}</b>
                  <span className="tiny muted">
                    {m.empNo}
                    {m.designation ? ` · ${m.designation}` : ''}
                    {def ? ` · default ${def.code}` : ''}
                  </span>
                </td>
                {dates.map((d) => {
                  const day = tools.map.get(key(m.id, d));
                  const plan = data.check.days[m.id]?.[d];
                  const hol = data.holidays[d];
                  const issues = data.check.issues.filter((i) => i.employeeId === m.id && i.date === d);
                  const err = issues.some((i) => i.level === 'error');
                  const warn = !err && issues.length > 0;
                  const leave = data.leave.filter((l) => l.employeeId === m.id && l.fromDate <= d && l.toDate >= d);
                  const carry = tools.carryIn(m.id, d);
                  const own = tools.own(m.id, d);
                  const off = !day || day.isOff || own.length === 0;
                  const pat = day?.shiftPatternId ? pmap.get(day.shiftPatternId) : undefined;
                  const isSel = selected.some((s) => s.employeeId === m.id && s.date === d);
                  const cls = ['cell', day && off && !carry.length ? 'off' : '', hol ? 'hol' : '', err ? 'err' : ''].join(' ');
                  return (
                    <td key={d}>
                      <button
                        type="button"
                        className={cls}
                        onClick={() => onCell({ employeeId: m.id, date: d })}
                        style={{ cursor: editable ? 'pointer' : 'default', ...(isSel ? { background: 'var(--info-bg)', boxShadow: 'inset 0 0 0 2px var(--blue)' } : {}) }}
                        title={issues.map((i) => i.message).join('\n') || day?.note || undefined}
                      >
                        {carry.map((s, i) => (
                          <span key={`c${i}`} className="faint" style={{ display: 'block' }}>
                            ↳ {t24(s.start)}–{t24(s.end)}
                          </span>
                        ))}
                        {!day ? (
                          <span className="faint">{editable ? '+ Set' : '—'}</span>
                        ) : off ? (
                          <span className="t">Off</span>
                        ) : (
                          <>
                            {pat && (
                              <span className="shift-pill" style={{ background: pat.color, marginBottom: 2 }}>
                                {pat.code}
                              </span>
                            )}
                            {own.map((b, i) => (
                              <span key={i} className="t">
                                {hhmm(b.start)}–{b.nextDay && b.end === 0 ? '24:00' : hhmm(b.end)}
                                {b.nextDay && b.end > 0 && <sup className="faint"> +1</sup>}
                                {b.mode === 'REMOTE' && <span style={{ color: 'var(--magenta)' }}> R</span>}
                              </span>
                            ))}
                          </>
                        )}
                        {plan && plan.paidMinutes > 0 && (
                          <span style={{ display: 'block' }}>
                            {hours(plan.paidMinutes)} paid
                            {plan.plannedOtMinutes > 0 && <span className="ot"> +{dur(plan.plannedOtMinutes)} OT</span>}
                          </span>
                        )}
                        {leave.map((l, i) => (
                          <span
                            key={`l${i}`}
                            className="chip"
                            style={{ marginTop: 2, padding: '0 5px', fontSize: 10.5, background: l.status === 'APPROVED' ? l.leaveType.color + '22' : 'transparent', color: l.leaveType.color, border: l.status === 'PENDING' ? `1px dashed ${l.leaveType.color}` : undefined }}
                            title={`${l.leaveType.name}${l.halfDay ? ` (${l.halfDay})` : ''} — ${l.status === 'PENDING' ? 'pending' : 'approved'}`}
                          >
                            {l.leaveType.name}
                            {l.halfDay ? ` ${l.halfDay}` : ''}
                            {l.status === 'PENDING' ? ' ?' : ''}
                          </span>
                        ))}
                        {warn && <span className="tiny warn-t" style={{ display: 'block' }}>⚠ check</span>}
                      </button>
                    </td>
                  );
                })}
                <td style={{ padding: '7px 10px' }}>
                  <div className={`small ${totalOt > WEEKLY_CAP ? 'bad-t' : ''}`} style={{ fontWeight: 600 }}>
                    {dur(weekOt)}
                    {approved > 0 && <span className="muted" style={{ fontWeight: 400 }}> + {dur(approved)} approved</span>}
                  </div>
                  <Progress value={totalOt} max={WEEKLY_CAP} tone={totalOt > WEEKLY_CAP ? 'bad' : totalOt >= WEEKLY_CAP * 0.85 ? 'warn' : 'ok'} />
                  <div className="tiny faint">of {dur(WEEKLY_CAP)}</div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function IssuesPanel({ data, onOpen }: { data: WeekData; onOpen?: (t: Target) => void }) {
  const names = new Map(data.members.map((m) => [m.id, fullName(m)]));
  const issues = [...data.check.issues].sort((a, b) => (a.level === b.level ? (a.date ?? '').localeCompare(b.date ?? '') : a.level === 'error' ? -1 : 1));
  const errs = issues.filter((i) => i.level === 'error').length;
  return (
    <Card title="Checks" sub={issues.length ? `${errs} problem${errs === 1 ? '' : 's'} to fix, ${issues.length - errs} warning${issues.length - errs === 1 ? '' : 's'}` : undefined}>
      {issues.length === 0 ? (
        <div className="ok-t small">No problems found. Rest days, daily length and the weekly overtime limit are all fine.</div>
      ) : (
        <div className="stack tight">
          {issues.map((i, n) => {
            const body = (
              <>
                <span className={`dot ${i.level === 'error' ? 'bad' : 'warn'}`} style={{ marginTop: 6 }} />
                <span>
                  {i.employeeId && <b>{names.get(i.employeeId) ?? 'Employee'}</b>}
                  {i.date && <span className="muted"> · {fmtDate(i.date, { weekday: true, year: false })}</span>}
                  <span className={i.level === 'error' ? 'bad-t' : 'warn-t'} style={{ display: 'block' }}>
                    {i.message}
                  </span>
                </span>
              </>
            );
            return onOpen && i.date && i.employeeId && i.date >= data.weekStart && i.date <= addDays(data.weekStart, 6) ? (
              <button key={n} type="button" className="row" style={{ alignItems: 'flex-start', textAlign: 'left', gap: 8 }} onClick={() => onOpen({ employeeId: i.employeeId, date: i.date as string })}>
                {body}
              </button>
            ) : (
              <div key={n} className="row" style={{ alignItems: 'flex-start', gap: 8 }}>
                {body}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ─── cell editor ──────────────────────────────────────────────

type EditKind = 'off' | 'pattern' | 'custom';
interface BlockRow {
  start: string;
  end: string;
  mode: Mode;
}

function CellEditor({ data, base, targets, patterns, onClose, onSaved }: { data: WeekData; base: string; targets: Target[]; patterns: Pattern[]; onClose: () => void; onSaved: (w: WeekData) => void }) {
  const tools = useMemo(() => weekTools(data), [data]);
  const first = targets[0];
  const member = data.members.find((m) => m.id === first.employeeId);
  const firstDay = tools.map.get(key(first.employeeId, first.date));
  const firstOwn = tools.own(first.employeeId, first.date);

  const initKind: EditKind = !firstDay ? (member?.defaultShiftPatternId && patterns.some((p) => p.id === member.defaultShiftPatternId) ? 'pattern' : 'custom') : firstDay.isOff || firstOwn.length === 0 ? 'off' : firstDay.shiftPatternId ? 'pattern' : 'custom';
  const [kind, setKind] = useState<EditKind>(initKind);
  const [patternId, setPatternId] = useState(firstDay?.shiftPatternId ?? member?.defaultShiftPatternId ?? patterns[0]?.id ?? '');
  const [blocks, setBlocks] = useState<BlockRow[]>(firstOwn.length ? firstOwn.map((b) => ({ start: hhmm(b.start), end: hhmm(b.end), mode: b.mode })) : [{ start: '08:30', end: '17:30', mode: 'OFFICE' }]);
  const [note, setNote] = useState(firstDay?.note ?? '');
  const [weekdays, setWeekdays] = useState(false);
  const act = useAction();

  const finalTargets = useMemo(() => {
    const all = [...targets];
    if (weekdays) for (const e of new Set(targets.map((t) => t.employeeId))) for (let i = 0; i < 5; i++) all.push({ employeeId: e, date: addDays(data.weekStart, i) });
    const seen = new Set<string>();
    return all.filter((t) => (seen.has(key(t.employeeId, t.date)) ? false : (seen.add(key(t.employeeId, t.date)), true))).sort((a, b) => a.date.localeCompare(b.date));
  }, [targets, weekdays, data.weekStart]);
  const targetKeys = new Set(finalTargets.map((t) => key(t.employeeId, t.date)));
  const keptCarry = (t: Target) => (targetKeys.has(key(t.employeeId, addDays(t.date, -1))) ? [] : tools.carryIn(t.employeeId, t.date));

  const pattern = patterns.find((p) => p.id === patternId) ?? null;
  const typedOk = blocks.every((b) => /^\d{2}:\d{2}$/.test(b.start) && /^\d{2}:\d{2}$/.test(b.end));
  /** Blocks as typed minutes: end ≤ start means past midnight. */
  const typed: Segment[] =
    kind === 'off' ? [] : kind === 'pattern' ? (pattern?.segments ?? []).map((s) => ({ start: s.start, end: s.end >= 1440 ? s.end - 1440 : s.end, mode: 'OFFICE' as Mode })) : typedOk ? blocks.map((b) => ({ start: parseHhmm(b.start), end: parseHhmm(b.end), mode: b.mode })) : [];

  // preview for the first chosen date
  const carry0 = keptCarry(first);
  const todayPieces = [...carry0.map((s) => ({ start: s.start, end: s.end })), ...typed.map((s) => ({ start: s.start, end: s.end > s.start ? s.end : 1440 }))];
  const nextPieces = typed.filter((s) => s.end <= s.start && s.end > 0).map((s) => ({ start: 0, end: s.end }));
  const sorted = [...todayPieces].sort((a, b) => a.start - b.start);
  const overlap = sorted.some((b, i) => i > 0 && b.start < sorted[i - 1].end);
  const plan = planDay(todayPieces);
  const tooLong = plan.totalMinutes > 16 * 60;
  const tooMany = carry0.length + typed.length > 4;
  const canSave = !act.busy && !overlap && !tooMany && (kind === 'off' || (kind === 'pattern' ? !!pattern : typedOk && typed.length > 0 && typed.every((s) => s.start !== s.end)));

  const save = async () => {
    const n = note.trim() || null;
    const days = finalTargets.map((t) => {
      const carry = keptCarry(t).map((s) => ({ start: s.start, end: s.end, mode: s.mode ?? 'OFFICE' }));
      if (kind === 'off') return carry.length ? { employeeId: t.employeeId, date: t.date, blocks: carry, note: n } : { employeeId: t.employeeId, date: t.date, isOff: true, note: n };
      if (kind === 'pattern' && !carry.length) return { employeeId: t.employeeId, date: t.date, shiftPatternId: patternId, note: n };
      return { employeeId: t.employeeId, date: t.date, blocks: [...carry, ...typed.map((s) => ({ start: s.start, end: s.end, mode: s.mode ?? 'OFFICE' }))], note: n };
    });
    const r = await act.run(() => api.put<WeekData>(`${base}/days`, { days }));
    if (r !== undefined) onSaved(r);
  };

  const setBlock = (i: number, patch: Partial<BlockRow>) => setBlocks((b) => b.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const names = new Map(data.members.map((m) => [m.id, fullName(m)]));
  const people = [...new Set(finalTargets.map((t) => t.employeeId))];
  const holiday = data.holidays[first.date];
  const leave = data.leave.filter((l) => l.employeeId === first.employeeId && l.fromDate <= first.date && l.toDate >= first.date);

  return (
    <Modal
      title={finalTargets.length === 1 ? `${names.get(first.employeeId) ?? ''} · ${fmtDate(first.date, { weekday: true, year: false })}` : `Edit ${finalTargets.length} days`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="pri" busy={act.busy} disabled={!canSave} onClick={save}>
            Save {finalTargets.length > 1 ? `${finalTargets.length} days` : ''}
          </Button>
        </>
      }
    >
      <div className="stack">
        <ErrorBox error={act.error} />
        {finalTargets.length > 1 && (
          <div className="small muted">
            {people.map((p) => names.get(p)).join(', ')} —{' '}
            {[...new Set(finalTargets.map((t) => t.date))].map((d) => fmtDate(d, { weekday: true, year: false })).join(', ')}
          </div>
        )}
        {holiday && <Alert tone="info">{holiday.name}: hours worked are paid at {holiday.multiplier}×. The holiday premium is not overtime.</Alert>}
        {leave.map((l, i) => (
          <Alert key={i} tone="warn">
            {l.status === 'APPROVED' ? 'On' : 'Has asked for'} {l.leaveType.name.toLowerCase()}
            {l.halfDay ? ` (${l.halfDay})` : ''} this day.
          </Alert>
        ))}

        <Seg<EditKind>
          value={kind}
          onChange={setKind}
          options={[
            { value: 'off', label: 'Off (rest day)' },
            { value: 'pattern', label: 'Shift pattern' },
            { value: 'custom', label: 'Custom times' },
          ]}
        />

        {carry0.length > 0 && (
          <div className="small muted">
            Kept from the previous night&apos;s shift: {carry0.map((s) => `${t24(s.start)}–${t24(s.end)}`).join(', ')}.
          </div>
        )}

        {kind === 'off' && <p className="muted small">A rest day. Everyone needs at least one rest day each week.</p>}

        {kind === 'pattern' &&
          (patterns.length === 0 ? (
            <Alert tone="warn">There are no active shift patterns. Add them on the Shift patterns page, or use custom times.</Alert>
          ) : (
            <Field label="Shift">
              <Select
                value={patternId}
                onChange={(e) => setPatternId(e.target.value)}
                options={patterns.map((p) => ({ value: p.id, label: `${p.code} · ${p.name} (${p.segments.map((s) => `${hhmm(s.start)}–${s.end >= 1440 && s.end !== 1440 ? hhmm(s.end) + ' +1' : t24(s.end)}`).join(' + ')})` }))}
              />
            </Field>
          ))}

        {kind === 'custom' && (
          <div>
            <div className="stack tight">
              {blocks.map((b, i) => {
                const night = typedOk && parseHhmm(b.end) <= parseHhmm(b.start);
                return (
                  <div className="row tight" key={i}>
                    <Input type="time" value={b.start} onChange={(e) => setBlock(i, { start: e.target.value })} style={{ width: 120 }} aria-label="Start" />
                    <span className="faint">to</span>
                    <Input type="time" value={b.end} onChange={(e) => setBlock(i, { end: e.target.value })} style={{ width: 120 }} aria-label="End" />
                    <Seg<Mode>
                      value={b.mode}
                      onChange={(v) => setBlock(i, { mode: v })}
                      options={[
                        { value: 'OFFICE', label: 'Office' },
                        { value: 'REMOTE', label: 'Remote' },
                      ]}
                    />
                    {night && <Chip tone="info">next day</Chip>}
                    {blocks.length > 1 && <Button size="xs" variant="ghost" icon="x" aria-label="Remove block" onClick={() => setBlocks((x) => x.filter((_, j) => j !== i))} />}
                  </div>
                );
              })}
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <Button size="xs" icon="plus-clock" disabled={blocks.length + carry0.length >= 4} onClick={() => setBlocks((b) => [...b, { start: '16:00', end: '20:00', mode: 'OFFICE' }])}>
                Add block (split shift)
              </Button>
            </div>
            <p className="tiny faint" style={{ marginTop: 6 }}>
              An end earlier than the start means the block continues past midnight into the next day. Up to 4 blocks a day.
            </p>
          </div>
        )}

        {kind !== 'off' && (
          <div className="alert info">
            <div>
              {fmtDate(first.date, { weekday: true, year: false })}: total <b>{dur(plan.totalMinutes)}</b>
              {plan.mealMinutes > 0 ? <> − meal {dur(plan.mealMinutes)}</> : plan.totalMinutes > 0 ? <> (no meal deduction — no single block covers 12:00–13:00)</> : null} = paid <b>{dur(plan.paidMinutes)}</b>
              {plan.plannedOtMinutes > 0 && (
                <>
                  {' '}
                  · <b>{dur(plan.plannedOtMinutes)} planned overtime</b>
                </>
              )}
              {nextPieces.length > 0 && <div className="small">Continues into the next day: {nextPieces.map((s) => `00:00–${hhmm(s.end)}`).join(', ')} (counted on that date).</div>}
            </div>
          </div>
        )}
        {overlap && <Alert tone="bad">Time blocks overlap.</Alert>}
        {tooMany && <Alert tone="bad">A day can have at most 4 blocks.</Alert>}
        {tooLong && <Alert tone="bad">More than 16 hours in one day breaks the daily limit.</Alert>}

        <Toggle checked={weekdays} onChange={setWeekdays} label="Apply to the whole week (Mon–Fri)" />
        <Field label="Note (optional)" hint="Shown to the team with the shift.">
          <Input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

// ─── roster groups ────────────────────────────────────────────

function GroupsTab({ groups, reload, onOpen }: { groups: Group[]; reload: () => void; onOpen: (groupId: string, week?: string) => void }) {
  const [edit, setEdit] = useState<Group | 'new' | null>(null);
  const act = useAction();
  const { toast, confirm } = useUi();
  const list = [...groups].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));

  const remove = async (g: Group) => {
    const ok = await confirm({
      title: `Delete ${g.name}?`,
      body: g.weeks.length ? 'This group has roster history, so it is made inactive and its members are released. Past rosters are kept.' : 'Its members are released from the group.',
      ok: 'Delete group',
      danger: true,
    });
    if (ok === false) return;
    const r = await act.run(() => api.del(`/roster/groups/${g.id}`));
    if (r !== undefined) {
      toast('Roster group deleted.');
      reload();
    }
  };

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <Alert tone="info">HR decides who makes each roster. The maker drafts the week, the approver (or the Head of HR) approves, then it is published to the team&apos;s app. An employee belongs to one roster group at a time.</Alert>
      </div>
      <ErrorBox error={act.error} />
      <Card
        pad={false}
        title="Roster groups"
        actions={
          <Button variant="pri" size="sm" icon="users" onClick={() => setEdit('new')}>
            New group
          </Button>
        }
      >
        {list.length === 0 ? (
          <Empty title="No roster groups yet" icon="grid" action={<Button variant="pri" onClick={() => setEdit('new')}>Create the first group</Button>}>
            For example “Kitchen — Colombo” with the head chef as maker.
          </Empty>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Maker</th>
                  <th>Approver</th>
                  <th className="num">Members</th>
                  <th>Recent weeks</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((g) => (
                  <tr key={g.id} style={g.active ? undefined : { opacity: 0.55 }}>
                    <td>
                      <b>{g.name}</b>
                      {!g.active && (
                        <>
                          {' '}
                          <Chip>Inactive</Chip>
                        </>
                      )}
                    </td>
                    <td>
                      {g.maker.name}
                      <div className="tiny muted">{g.maker.role.replace(/_/g, ' ').toLowerCase()}</div>
                    </td>
                    <td>{g.approver ? g.approver.name : <span className="muted">Head of HR</span>}</td>
                    <td className="num">{g.members.length}</td>
                    <td>
                      <div className="row tight" style={{ gap: 4 }}>
                        {g.weeks.length === 0 && <span className="faint small">None yet</span>}
                        {g.weeks.map((w) => (
                          <button key={w.id} type="button" title="Open this week" onClick={() => g.active && onOpen(g.id, w.weekStart)} style={{ padding: 0 }}>
                            <StatusChip status={w.status} labelText={`${fmtDate(w.weekStart, { year: false })} · ${w.status.toLowerCase()}${w.revision > 1 ? ` r${w.revision}` : ''}`} />
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="nowrap right">
                      {g.active && (
                        <Button size="sm" variant="ghost" icon="grid" onClick={() => onOpen(g.id)}>
                          Open roster
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" icon="edit" onClick={() => setEdit(g)}>
                        Edit
                      </Button>
                      {g.active && <Button size="sm" variant="ghost" icon="trash" aria-label="Delete" disabled={act.busy} onClick={() => remove(g)} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {edit && (
        <GroupModal
          group={edit === 'new' ? null : edit}
          groups={groups}
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

function GroupModal({ group, groups, onClose, onSaved }: { group: Group | null; groups: Group[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(group?.name ?? '');
  const [makerId, setMakerId] = useState(group?.makerId ?? '');
  const [approverId, setApproverId] = useState(group?.approverId ?? '');
  const [active, setActive] = useState(group?.active ?? true);
  const [members, setMembers] = useState<string[]>(group?.members.map((m) => m.id) ?? []);
  const [q, setQ] = useState('');
  const [onlyChosen, setOnlyChosen] = useState(false);
  const [emps, setEmps] = useState<Emp[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const act = useAction();
  const { toast } = useUi();

  useEffect(() => {
    let stop = false;
    (async () => {
      const all: Emp[] = [];
      for (let page = 1; page < 50; page++) {
        const r = await api.get<{ rows: Emp[]; total: number }>('/employees', { pageSize: 200, page });
        all.push(...r.rows);
        if (all.length >= r.total || r.rows.length === 0) break;
      }
      if (!stop) setEmps(all);
    })().catch((e) => !stop && setLoadErr(errorMessage(e)));
    return () => {
      stop = true;
    };
  }, []);

  const otherGroup = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) if (g.id !== group?.id && g.active) for (const e of g.members) m.set(e.id, g.name);
    return m;
  }, [groups, group]);

  const chosen = new Set(members);
  const needle = q.trim().toLowerCase();
  const shown = (emps ?? []).filter((e) => (!onlyChosen || chosen.has(e.id)) && (!needle || `${e.firstName} ${e.lastName} ${e.empNo} ${e.designation ?? ''}`.toLowerCase().includes(needle)));
  const moving = members.filter((id) => otherGroup.has(id)).length;
  const canSave = name.trim().length >= 2 && !!makerId;

  const toggle = (id: string, on: boolean) => setMembers((m) => (on ? (m.includes(id) ? m : [...m, id]) : m.filter((x) => x !== id)));

  const save = async () => {
    const body = { name: name.trim(), makerId, approverId: approverId || null, memberIds: members, ...(group ? { active } : {}) };
    const r = await act.run(() => (group ? api.patch(`/roster/groups/${group.id}`, body) : api.post('/roster/groups', body)));
    if (r !== undefined) {
      toast(group ? 'Roster group saved.' : 'Roster group created.');
      onSaved();
    }
  };

  return (
    <Modal
      title={group ? `Edit ${group.name}` : 'New roster group'}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="pri" busy={act.busy} disabled={!canSave} onClick={save}>
            {group ? 'Save group' : 'Create group'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <ErrorBox error={act.error} />
        <div className="form-grid">
          <Field label="Group name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kitchen — Colombo" />
          </Field>
          <Field label="Roster maker" required hint="Drafts and submits the weekly roster.">
            <UserSelect value={makerId} onChange={setMakerId} roles={['OWNER', 'HR_MANAGER', 'HR_OFFICER', 'MANAGER', 'PAYROLL_OFFICER']} />
          </Field>
          <Field label="Approver" hint="Leave empty and the Head of HR approves.">
            <UserSelect value={approverId} onChange={setApproverId} roles={['OWNER', 'HR_MANAGER', 'HR_OFFICER']} placeholder="Head of HR (default)" />
          </Field>
          {group && (
            <Field label="Status">
              <Toggle checked={active} onChange={setActive} label={active ? 'Active' : 'Inactive'} />
            </Field>
          )}
        </div>

        <div>
          <div className="row between" style={{ marginBottom: 6 }}>
            <b className="small">
              Members <span className="muted">({members.length} chosen)</span>
            </b>
            <div className="row tight">
              <Input className="sm" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 200 }} />
              <Check checked={onlyChosen} onChange={setOnlyChosen} label={<span className="small">Chosen only</span>} />
              <Button size="xs" disabled={!shown.length} onClick={() => setMembers((m) => [...new Set([...m, ...shown.map((e) => e.id)])])}>
                Select shown
              </Button>
              <Button size="xs" variant="ghost" disabled={!members.length} onClick={() => setMembers([])}>
                Clear
              </Button>
            </div>
          </div>
          {loadErr ? (
            <Alert>{loadErr}</Alert>
          ) : !emps ? (
            <Loading text="Loading employees…" />
          ) : (
            <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--rule)', borderRadius: 8 }}>
              {shown.length === 0 && <div className="muted small" style={{ padding: 12 }}>No employees match.</div>}
              {shown.map((e) => {
                const other = otherGroup.get(e.id);
                return (
                  <div key={e.id} className="row" style={{ padding: '6px 12px', borderBottom: '1px solid var(--rule)' }}>
                    <Check
                      checked={chosen.has(e.id)}
                      onChange={(v) => toggle(e.id, v)}
                      label={
                        <span>
                          <b style={{ fontWeight: 600 }}>
                            {e.firstName} {e.lastName}
                          </b>{' '}
                          <span className="muted small">
                            {e.empNo}
                            {e.designation ? ` · ${e.designation}` : ''}
                            {e.department ? ` · ${e.department.name}` : ''}
                          </span>
                        </span>
                      }
                    />
                    {other && <span className={`tiny ${chosen.has(e.id) ? 'warn-t' : 'faint'}`} style={{ marginLeft: 'auto' }}>{chosen.has(e.id) ? `moves from ${other}` : `in ${other}`}</span>}
                  </div>
                );
              })}
            </div>
          )}
          {moving > 0 && (
            <p className="tiny warn-t" style={{ marginTop: 6 }}>
              {moving} employee{moving === 1 ? '' : 's'} will move out of another roster group.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
