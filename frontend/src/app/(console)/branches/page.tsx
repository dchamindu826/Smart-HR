'use client';

import Link from 'next/link';
import { useApi, usePoll } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { date, today } from '@/lib/format';
import { Async, Card, Chip, Empty, LinkButton, PageHeader, Progress } from '@/components/ui';

interface BranchOverview {
  id: string;
  code: string;
  name: string;
  address: string | null;
  hasFence: boolean;
  headcount: number;
  present: number;
  inNow: number;
  remoteNow: number;
  onLeave: number;
  notIn: number;
  pendingLeave: number;
  lateThisMonth: number;
  attendancePct: number;
  terminals: number;
  departments: number;
}

const tone = (pct: number): 'ok' | 'warn' | 'bad' => (pct >= 85 ? 'ok' : pct >= 60 ? 'warn' : 'bad');

export default function BranchesOverviewPage() {
  const { can } = useAuth();
  const { data, error, loading, reload } = useApi<BranchOverview[]>('/org/branches/overview');
  usePoll(reload, 60_000);

  return (
    <>
      <PageHeader
        title="All branches"
        sub={`Today, ${date(today(), { weekday: true })}. Updates every minute.`}
        actions={can('org.edit') ? <LinkButton href="/settings/branches" icon="cog">Branches &amp; departments</LinkButton> : undefined}
      />
      <Async data={data} error={error} loading={loading}>
        {(rows) => {
          if (rows.length === 0)
            return (
              <Card>
                <Empty title="No branches" icon="building">
                  Add your first branch under Branches &amp; departments.
                </Empty>
              </Card>
            );
          const sum = (k: keyof BranchOverview) => rows.reduce((n, r) => n + (r[k] as number), 0);
          const head = sum('headcount');
          const present = sum('present');
          const pct = head ? Math.round((present / head) * 100) : 0;
          return (
            <>
              <section className="bento" aria-label="All branches today">
                <article className="tile hero w2">
                  <div className="live">
                    <i /> All branches · live
                  </div>
                  <div className="row" style={{ alignItems: 'flex-end', gap: 18 }}>
                    <div className="big xl">{pct}%</div>
                    <div className="lbl" style={{ paddingBottom: 6 }}>
                      {present} of {head} marked in · {sum('inNow')} in now · {sum('remoteNow')} remote
                    </div>
                  </div>
                  <Progress value={present} max={head} tone={head ? tone(pct) : undefined} />
                </article>
                <Link href="/leave" className="tile">
                  <h2>On leave</h2>
                  <div className="big xl" style={{ color: 'var(--magenta)' }}>{sum('onLeave')}</div>
                  <div className="lbl">{sum('pendingLeave')} requests waiting</div>
                </Link>
                <Link href="/attendance?status=NOT_IN" className="tile">
                  <h2>Not in</h2>
                  <div className="big xl" style={{ color: 'var(--bad)' }}>{sum('notIn')}</div>
                  <div className="lbl">{sum('lateThisMonth')} late days this month</div>
                </Link>
              </section>

              <div className="bento">
                {rows.map((b) => (
                  <div key={b.id} className="tile" style={{ padding: 0, overflow: 'hidden' }}>
                  <Card className="flat"
                    title={
                      <Link href={`/attendance?branchId=${b.id}`} style={{ color: 'inherit' }}>
                        {b.name}
                      </Link>
                    }
                    sub={b.code}
                    actions={b.hasFence ? <Chip tone="ok">Fence set</Chip> : <Chip tone="warn" title="Set the branch location so office mark-ins can be checked">No fence</Chip>}
                  >
                    <div className="stack tight">
                      <div className="row between">
                        <span>
                          <b style={{ fontSize: 24, fontFamily: 'Poppins, sans-serif' }}>{b.attendancePct}%</b> <span className="muted small">in today</span>
                        </span>
                        <span className="small muted">
                          {b.present} of {b.headcount}
                        </span>
                      </div>
                      <Progress value={b.present} max={b.headcount} tone={b.headcount ? tone(b.attendancePct) : undefined} />
                      <dl className="kv" style={{ gridTemplateColumns: '1fr auto', marginTop: 6, fontSize: 13.5 }}>
                        <dt>Headcount</dt>
                        <dd className="right">{b.headcount}</dd>
                        <dt>In now</dt>
                        <dd className="right">
                          {b.inNow}
                          {b.remoteNow > 0 && <span className="muted small"> ({b.remoteNow} remote)</span>}
                        </dd>
                        <dt>On leave</dt>
                        <dd className="right">{b.onLeave}</dd>
                        <dt>Not in</dt>
                        <dd className={`right ${b.notIn ? 'bad-t' : ''}`}>{b.notIn}</dd>
                        <dt>Leave waiting</dt>
                        <dd className="right">{b.pendingLeave ? <Chip tone="warn">{b.pendingLeave}</Chip> : 0}</dd>
                        <dt>Late this month</dt>
                        <dd className={`right ${b.lateThisMonth ? 'warn-t' : ''}`}>{b.lateThisMonth}</dd>
                        <dt>Terminals</dt>
                        <dd className="right">{b.terminals}</dd>
                        <dt>Departments</dt>
                        <dd className="right">{b.departments}</dd>
                      </dl>
                      {b.address && <div className="small faint">{b.address}</div>}
                      <div className="row tight" style={{ marginTop: 4 }}>
                        <Link className="btn sm" href={`/attendance?branchId=${b.id}`}>
                          Attendance
                        </Link>
                        <Link className="btn sm ghost" href={`/employees?branchId=${b.id}`}>
                          Employees
                        </Link>
                      </div>
                    </div>
                  </Card>
                  </div>
                ))}
              </div>
            </>
          );
        }}
      </Async>
    </>
  );
}
