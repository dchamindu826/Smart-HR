'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { useApi, usePoll } from '@/lib/hooks';
import { ago, date, dur, initials, label, money, periodLabel, today } from '@/lib/format';
import { Alert, Avatar, Loading, StatusChip } from '@/components/ui';
import { Icon, type IconKey } from '@/components/Icon';

interface Dashboard {
  date: string;
  today: { total: number; in: number; present: number; remoteNow: number; late: number; leave: number; notIn: number; off: number; flagged: number };
  holiday: { name: string; multiplier: number } | null;
  notIn: { id: string; name: string; designation: string | null; department: string | null }[];
  lateToday: { id: string; name: string; lateMinutes: number }[];
  approvals: { leave: number; overtime: number; corrections: number; assets: number; roster: number; total: number };
  headcount: number;
  joinersThisMonth: number;
  leaversThisMonth: number;
  birthdays: { id: string; name: string; designation: string | null; inDays: number; day: string }[];
  holidays: { date: string; name: string; kind: string; multiplier: string }[];
  payroll: { id: string; period: string; status: string; totals: Record<string, string | number> | null } | null;
  nextPayrollPeriod: string;
  docsExpiring: number;
  probationEnding: { id: string; name: string; joinDate: string }[];
  trend: { date: string; present: number; absent: number; leave: number; late: number }[];
}

interface BranchRow {
  id: string;
  name: string;
  headcount: number;
  present: number;
  attendancePct: number;
}

const PAY_STEPS = ['DRAFT', 'CALCULATED', 'APPROVED', 'LOCKED'];

function Ring({ value, total }: { value: number; total: number }) {
  const c = 2 * Math.PI * 52;
  const pct = total ? Math.min(1, value / total) : 0;
  return (
    <svg role="img" aria-label={`${value} of ${total} marked in`} width="150" height="150" viewBox="0 0 120 120">
      <defs>
        <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--pink)" />
          <stop offset=".5" stopColor="var(--magenta)" />
          <stop offset="1" stopColor="var(--blue)" />
        </linearGradient>
      </defs>
      <circle cx="60" cy="60" r="52" fill="none" stroke="var(--card-2)" strokeWidth="12" />
      <circle cx="60" cy="60" r="52" fill="none" stroke="url(#ring-grad)" strokeWidth="12" strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} transform="rotate(-90 60 60)" />
      <text x="60" y="58" textAnchor="middle" fontFamily="Poppins, sans-serif" fontWeight="700" fontSize="28" fill="var(--ink)">
        {value}
      </text>
      <text x="60" y="78" textAnchor="middle" fontSize="11" fill="var(--ink-2)">
        of {total} in
      </text>
    </svg>
  );
}

function Mini({ labelText, value, color }: { labelText: string; value: number; color?: string }) {
  return (
    <div>
      <div className="lbl">{labelText}</div>
      <div className="big" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

function QuickAction({ href, icon, color, children }: { href: string; icon: IconKey; color: string; children: string }) {
  return (
    <Link href={href}>
      <span style={{ color, display: 'grid' }}>
        <Icon name={icon} />
      </span>
      {children}
    </Link>
  );
}

export default function DashboardPage() {
  const { me, can } = useAuth();
  const { data, error, loading, reload } = useApi<Dashboard>('/dashboard');
  const wide = me && ['OWNER', 'HR_MANAGER', 'HR_OFFICER', 'PAYROLL_OFFICER'].includes(me.user.role);
  const branches = useApi<BranchRow[]>(wide ? '/org/branches/overview' : null);
  usePoll(reload, 60_000);

  const hour = Number(new Date().toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Colombo' }));
  const greet = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';

  if (error && !data) return <Alert>{error}</Alert>;
  if (!data) return loading ? <Loading /> : null;
  const d = data;
  const maxTrend = Math.max(1, ...d.trend.map((t) => t.present));
  const nextHoliday = d.holidays[0] ?? null;
  const payStep = d.payroll ? Math.max(0, PAY_STEPS.indexOf(d.payroll.status)) : -1;

  return (
    <>
      <div className="ph">
        <div>
          <p style={{ marginTop: 0 }}>
            {date(today(), { weekday: true })} · {me?.tenant.name}
          </p>
          <h1>
            Good {greet}, {me?.user.name.split(' ')[0]}
          </h1>
        </div>
      </div>

      {d.holiday && (
        <div className="alert info" style={{ marginBottom: 14 }}>
          Today is {d.holiday.name} — pay {d.holiday.multiplier}× for anyone working.
        </div>
      )}

      <section className="bento" aria-label="Today at a glance">
        {/* live attendance */}
        <article className="tile hero w2 h2" style={{ minHeight: 340 }}>
          <div className="live">
            <i /> Live attendance · {d.today.total} expected today
          </div>
          <div className="ring-wrap">
            <Ring value={d.today.present} total={d.today.total} />
            <div className="mini-grid">
              <Mini labelText="In now" value={d.today.in} />
              <Mini labelText="Working remotely" value={d.today.remoteNow} color="var(--magenta)" />
              <Mini labelText="Late today" value={d.today.late} color="var(--warn)" />
              <Mini labelText="Not in yet" value={d.today.notIn} color="var(--bad)" />
            </div>
          </div>
          <div className="row" style={{ marginTop: 'auto' }}>
            <Link href="/attendance" className="btn grad">
              Open attendance board
            </Link>
            <Link href="/attendance?status=NOT_IN" className="btn soft">
              Who is not in
            </Link>
          </div>
        </article>

        {/* approvals */}
        <Link href="/approvals" className="tile">
          <div className="t-head">
            <h2>Waiting for you</h2>
            <span className="chip mag">{d.approvals.total}</span>
          </div>
          {d.approvals.total === 0 ? (
            <div className="lbl">All clear. Nothing is waiting.</div>
          ) : (
            <div className="stack tight">
              {(
                [
                  ['Leave requests', d.approvals.leave],
                  ['Overtime claims', d.approvals.overtime],
                  ['Attendance corrections', d.approvals.corrections],
                  ['Roster weeks', d.approvals.roster],
                  ['Equipment requests', d.approvals.assets],
                ] as [string, number][]
              )
                .filter(([, n]) => n > 0)
                .map(([t, n]) => (
                  <div className="rowkv" key={t}>
                    <span className="muted">{t}</span>
                    <b>{n}</b>
                  </div>
                ))}
            </div>
          )}
          <span className="t-foot" style={{ color: 'var(--blue)' }}>
            Review all
          </span>
        </Link>

        {/* payroll */}
        {can('payroll.view') ? (
          <Link href={d.payroll ? `/payroll/${d.payroll.id}` : '/payroll'} className="tile">
            <div className="t-head">
              <h2>{d.payroll ? `${periodLabel(d.payroll.period).split(' ')[0]} payroll` : 'Payroll'}</h2>
              {d.payroll && <StatusChip status={d.payroll.status} />}
            </div>
            {d.payroll?.totals && can('employee.pay.view') ? (
              <>
                <div className="lbl">Net pay</div>
                <div className="big" style={{ fontSize: 26 }}>
                  Rs {money(d.payroll.totals.net as string)}
                </div>
              </>
            ) : (
              <div className="lbl">{d.payroll ? 'Not calculated yet.' : `Start ${periodLabel(d.nextPayrollPeriod)}.`}</div>
            )}
            <div style={{ display: 'flex', gap: 4 }} aria-hidden="true">
              {PAY_STEPS.map((s, i) => (
                <span key={s} style={{ flex: 1, height: 6, borderRadius: 3, background: i <= payStep ? 'var(--blue)' : 'var(--card-2)' }} />
              ))}
            </div>
            <span className="t-foot" style={{ color: 'var(--blue)' }}>
              Open payroll
            </span>
          </Link>
        ) : (
          <Link href="/employees" className="tile">
            <h2>On the roll</h2>
            <div className="big xl">{d.headcount}</div>
            <div className="lbl">
              {d.joinersThisMonth} joined · {d.leaversThisMonth} left this month
            </div>
          </Link>
        )}

        {/* birthdays */}
        <article className="tile">
          <h2>Birthdays</h2>
          {d.birthdays.length === 0 ? (
            <div className="lbl">None in the next 7 days.</div>
          ) : (
            d.birthdays.slice(0, 3).map((b) => (
              <div className="person" key={b.id + b.day}>
                <Avatar name={b.name} photoEmployeeId={b.id} />
                <div>
                  <b>{b.name}</b>
                  <small style={{ color: b.inDays === 0 ? 'var(--magenta)' : undefined }}>{b.inDays === 0 ? 'Today' : b.inDays === 1 ? 'Tomorrow' : `In ${b.inDays} days`}</small>
                </div>
              </div>
            ))
          )}
        </article>

        {/* next holiday */}
        <Link href="/holidays" className="tile">
          <h2>Next holiday</h2>
          {nextHoliday ? (
            <>
              <div className="big" style={{ fontSize: 22 }}>
                {nextHoliday.name}
              </div>
              <div className="lbl">
                {date(nextHoliday.date, { weekday: true })} · {label(nextHoliday.kind)}
              </div>
              <span className="pill chip mag">Pay {nextHoliday.multiplier}× if working</span>
            </>
          ) : (
            <div className="lbl">No holidays marked for the next 60 days. Add Poya and gazetted days in the holiday calendar.</div>
          )}
          <span className="t-foot" style={{ color: 'var(--blue)' }}>
            Holiday calendar
          </span>
        </Link>

        {/* trend */}
        <article className="tile w2">
          <div className="t-head">
            <h2>Attendance — last 14 days</h2>
            <span className="lbl">people present each day</span>
          </div>
          {d.trend.every((t) => t.present === 0) ? (
            <div className="lbl">Days are closed after midnight. The chart fills in from tomorrow.</div>
          ) : (
            <div role="img" aria-label="People present each day for the last 14 days" style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 150, paddingTop: 6 }}>
              {d.trend.map((t, i) => {
                const last = i === d.trend.length - 1;
                return (
                  <div key={t.date} title={`${date(t.date)}: ${t.present} present, ${t.absent} absent, ${t.leave} on leave, ${t.late} late`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
                    <span
                      style={{
                        width: '100%',
                        maxWidth: 26,
                        height: t.present ? `${Math.max(6, (t.present / maxTrend) * 128)}px` : '6px',
                        borderRadius: t.present ? '7px 7px 3px 3px' : 3,
                        background: !t.present ? 'var(--card-2)' : last ? 'linear-gradient(180deg, var(--pink), var(--magenta))' : 'var(--blue)',
                      }}
                    />
                    <small style={{ fontSize: 11, color: last ? 'var(--magenta)' : 'var(--ink-3)', fontWeight: last ? 700 : 400 }}>{t.date.slice(8).replace(/^0/, '')}</small>
                  </div>
                );
              })}
            </div>
          )}
        </article>

        {/* not in yet */}
        <article className="tile">
          <h2>Not in yet</h2>
          {d.notIn.length === 0 ? (
            <div className="lbl">Everyone expected is in.</div>
          ) : (
            d.notIn.slice(0, 3).map((p) => (
              <Link key={p.id} href={`/attendance/${p.id}`} className="row tight" style={{ color: 'inherit', textDecoration: 'none', flexWrap: 'nowrap' }}>
                <span className="dot bad" />
                <span style={{ minWidth: 0 }}>
                  <b style={{ display: 'block' }}>{p.name}</b>
                  <span className="lbl">{[p.designation, p.department].filter(Boolean).join(' · ')}</span>
                </span>
              </Link>
            ))
          )}
          <Link href="/attendance?status=NOT_IN" className="t-foot">
            See all
          </Link>
        </article>

        {/* branches or watch list */}
        {wide && branches.data && branches.data.length > 0 ? (
          <Link href="/branches" className="tile">
            <h2>Branches today</h2>
            {branches.data.slice(0, 3).map((b) => (
              <div key={b.id}>
                <div className="rowkv">
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                  <b>{b.attendancePct}%</b>
                </div>
                <div className={`bar ${b.attendancePct >= 85 ? 'ok' : b.attendancePct >= 60 ? 'warn' : 'bad'}`} style={{ marginTop: 6, height: 8 }}>
                  <i style={{ width: `${b.attendancePct}%` }} />
                </div>
              </div>
            ))}
            <span className="t-foot" style={{ color: 'var(--blue)' }}>
              All branches
            </span>
          </Link>
        ) : (
          <article className="tile">
            <h2>Keep an eye on</h2>
            {d.lateToday.length + d.probationEnding.length + (d.docsExpiring ? 1 : 0) === 0 && <div className="lbl">Nothing to flag today.</div>}
            {d.lateToday.slice(0, 2).map((p) => (
              <div key={p.id} className="lbl">
                <b style={{ color: 'var(--ink)' }}>{p.name}</b> late by {dur(p.lateMinutes)}
              </div>
            ))}
            {d.probationEnding.slice(0, 2).map((p) => (
              <div key={p.id} className="lbl">
                <b style={{ color: 'var(--ink)' }}>{p.name}</b> on probation since {date(p.joinDate)}
              </div>
            ))}
            {d.docsExpiring > 0 && <div className="lbl">{d.docsExpiring} document(s) expire within 30 days</div>}
          </article>
        )}

        {/* quick actions */}
        <article className="tile w2">
          <h2>Quick actions</h2>
          <div className="qa">
            {can('employee.edit') && (
              <QuickAction href="/employees/new" icon="users" color="var(--blue)">
                Add employee
              </QuickAction>
            )}
            {can('import.run') && (
              <QuickAction href="/import" icon="upload" color="var(--magenta)">
                Import from Excel
              </QuickAction>
            )}
            {(me?.makesRoster || can('roster.groups')) && (
              <QuickAction href="/roster" icon="grid" color="var(--ok)">
                Make next roster
              </QuickAction>
            )}
            {can('announce.post') && (
              <QuickAction href="/announcements" icon="megaphone" color="var(--warn)">
                Post announcement
              </QuickAction>
            )}
            {can('payroll.run') && (
              <QuickAction href="/payroll" icon="money" color="var(--blue)">
                {`${periodLabel(d.nextPayrollPeriod)} payroll`}
              </QuickAction>
            )}
            {can('leave.approve') && (
              <QuickAction href="/leave" icon="leaf" color="var(--ok)">
                Add leave for someone
              </QuickAction>
            )}
          </div>
        </article>

        {/* headcount (when payroll took the slot above) */}
        {can('payroll.view') && (
          <Link href="/employees" className="tile">
            <h2>On the roll</h2>
            <div className="big xl">{d.headcount}</div>
            <div className="lbl">
              {d.joinersThisMonth} joined · {d.leaversThisMonth} left this month
            </div>
          </Link>
        )}
        <article className="tile">
          <h2>Today so far</h2>
          <div className="rowkv">
            <span className="muted">On leave</span>
            <b>{d.today.leave}</b>
          </div>
          <div className="rowkv">
            <span className="muted">Off / holiday</span>
            <b>{d.today.off}</b>
          </div>
          <div className="rowkv">
            <span className="muted">Flagged punches</span>
            <b style={{ color: d.today.flagged ? 'var(--warn)' : undefined }}>{d.today.flagged}</b>
          </div>
          <span className="lbl" style={{ marginTop: 'auto' }}>
            Refreshes every minute · {ago(new Date())}
          </span>
        </article>
      </section>
      <span className="sr">{initials(me?.user.name ?? '')}</span>
    </>
  );
}
