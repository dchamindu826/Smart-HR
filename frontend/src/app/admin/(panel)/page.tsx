'use client';

import Link from 'next/link';
import { useApi } from '@/lib/hooks';
import { date, label, money, moneyShort } from '@/lib/format';
import { Async, Bars, Card, Chip, Empty, LinkButton, PageHeader, Progress, Stat } from '@/components/ui';
import { useAdmin } from '@/components/AdminShell';
import { daysLeft, roleCan } from './_admin';

interface Analytics {
  totals: {
    companies: number;
    active: number;
    trial: number;
    suspended: number;
    cancelled: number;
    demos: number;
    employees: number;
    users: number;
    activeUsers7d: number;
    activeUsers30d: number;
    mrr: string;
    arr: string;
    arpa: string;
    invoicesDue: { count: number; amount: string };
    overdue: { count: number; amount: string };
    trialConversionPct: number;
  };
  byPlan: { code: string; plan: string; companies: number; mrr: string; employees: number }[];
  months: { month: string; created: number; cancelled: number }[];
  punchesPerDay: { date: string; punches: number }[];
  terminals: Record<string, number>;
  trialsEnding: { id: string; name: string; trialEndsAt: string | null; employees: number }[];
  nearLimit: { id: string; name: string; employees: number; max: number; plan: string }[];
  mostActive: { tenantId: string; name: string; punches30d: number }[];
}

const monthShort = (m: string) => new Date(m + '-01T00:00:00Z').toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });

export default function AdminOverviewPage() {
  const me = useAdmin();
  const { data, error, loading } = useApi<Analytics>('/platform/analytics');

  return (
    <>
      <PageHeader
        title="Overview & analytics"
        sub="Customers, revenue and usage across SmartHR. Demo companies are left out of revenue and customer counts."
        actions={
          <>
            <LinkButton href="/admin/tenants" icon="building">
              Companies
            </LinkButton>
            {roleCan(me.role, 'ADMIN') && (
              <LinkButton href="/admin/invoices" icon="receipt">
                Invoices
              </LinkButton>
            )}
          </>
        }
      />
      <Async data={data} error={error} loading={loading}>
        {(d) => {
          const t = d.totals;
          const maxMonth = Math.max(1, ...d.months.map((m) => Math.max(m.created, m.cancelled)));
          const terminalTotal = Object.values(d.terminals).reduce((a, n) => a + n, 0);
          return (
            <>
              <section className="bento" aria-label="Business at a glance">
                <article className="tile hero w2 h2">
                  <div className="live">
                    <i /> Monthly recurring revenue
                  </div>
                  <div className="big xl">{moneyShort(t.mrr)}</div>
                  <div className="lbl">Rs {money(t.mrr)} a month from {t.active} active companies</div>
                  <div className="mini-grid" style={{ marginTop: 8 }}>
                    <div>
                      <div className="lbl">ARR</div>
                      <div className="big">{moneyShort(t.arr)}</div>
                    </div>
                    <div>
                      <div className="lbl">Average per company</div>
                      <div className="big">{moneyShort(t.arpa)}</div>
                    </div>
                    <div>
                      <div className="lbl">Employees on SmartHR</div>
                      <div className="big" style={{ color: 'var(--blue)' }}>{t.employees.toLocaleString('en-LK')}</div>
                    </div>
                    <div>
                      <div className="lbl">Trial conversion</div>
                      <div className="big" style={{ color: 'var(--magenta)' }}>{t.trialConversionPct}%</div>
                    </div>
                  </div>
                  <div className="row" style={{ marginTop: 'auto' }}>
                    <a href="/admin/tenants" className="btn grad">
                      Companies
                    </a>
                    <a href="/admin/invoices" className="btn soft">
                      Invoices
                    </a>
                  </div>
                </article>
                <a href="/admin/tenants?status=ACTIVE" className="tile">
                  <h2>Active companies</h2>
                  <div className="big xl">{t.active}</div>
                  <div className="lbl">{t.companies} customers in all</div>
                </a>
                <a href="/admin/tenants?status=TRIAL" className="tile">
                  <h2>On trial</h2>
                  <div className="big xl" style={{ color: 'var(--magenta)' }}>{t.trial}</div>
                  <div className="lbl">{t.demos} demo account(s) on the side</div>
                </a>
                <a href="/admin/invoices?status=DUE" className="tile">
                  <h2>Invoices due</h2>
                  <div className="big" style={{ fontSize: 24 }}>Rs {money(t.invoicesDue.amount)}</div>
                  <div className="lbl">
                    {t.invoicesDue.count} due · <span style={{ color: t.overdue.count ? 'var(--bad)' : undefined }}>{t.overdue.count} overdue (Rs {money(t.overdue.amount)})</span>
                  </div>
                </a>
                <article className="tile">
                  <h2>People using it</h2>
                  <div className="big xl">{t.activeUsers7d}</div>
                  <div className="lbl">
                    active in 7 days · {t.activeUsers30d} in 30 days · {t.users} logins
                  </div>
                </article>
                <a href="/admin/tenants?status=SUSPENDED" className="tile w2">
                  <div className="t-head">
                    <h2>Account health</h2>
                    <span className={`chip ${t.suspended ? 'bad' : 'ok'}`}>{t.suspended ? `${t.suspended} suspended` : 'All active accounts paying'}</span>
                  </div>
                  <div className="mini-grid">
                    <div>
                      <div className="lbl">Suspended</div>
                      <div className="big" style={{ color: t.suspended ? 'var(--bad)' : undefined }}>{t.suspended}</div>
                    </div>
                    <div>
                      <div className="lbl">Cancelled</div>
                      <div className="big">{t.cancelled}</div>
                    </div>
                  </div>
                </a>
                <a href="/admin/demos" className="tile w2">
                  <div className="t-head">
                    <h2>Demo accounts</h2>
                    <span className="chip info">{t.demos}</span>
                  </div>
                  <div className="lbl">Demo companies have sample data and are not counted as customers. Convert one when the client signs up.</div>
                  <span className="t-foot" style={{ color: 'var(--blue)' }}>Manage demos</span>
                </a>
              </section>

              <div className="grid-main">
                <div className="stack">
                  <Card title="Revenue by plan" sub="active, non-demo companies" pad={false}>
                    {d.byPlan.length === 0 ? (
                      <Empty title="No active companies yet" icon="money">
                        Revenue shows here once a company is active.
                      </Empty>
                    ) : (
                      <div className="tbl-wrap">
                        <table className="tbl">
                          <thead>
                            <tr>
                              <th>Plan</th>
                              <th className="num">Companies</th>
                              <th className="num">Employees</th>
                              <th className="num">MRR (Rs)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {d.byPlan.map((p) => (
                              <tr key={p.code}>
                                <td>
                                  <b>{p.plan}</b> <span className="muted mono small">{p.code}</span>
                                </td>
                                <td className="num">{p.companies}</td>
                                <td className="num">{p.employees}</td>
                                <td className="num">{money(p.mrr)}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr>
                              <td>Total</td>
                              <td className="num">{d.byPlan.reduce((a, p) => a + p.companies, 0)}</td>
                              <td className="num">{d.byPlan.reduce((a, p) => a + p.employees, 0)}</td>
                              <td className="num">{money(t.mrr)}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}
                  </Card>

                  <Card title="New companies per month" sub="last 12 months">
                    <Bars max={maxMonth} data={d.months.map((m) => ({ label: monthShort(m.month), value: m.created, title: `${m.month}: ${m.created} new, ${m.cancelled} cancelled` }))} />
                    <div className="small muted" style={{ margin: '14px 0 2px' }}>
                      Cancelled per month
                    </div>
                    <Bars tone="mag" max={maxMonth} data={d.months.map((m) => ({ label: monthShort(m.month), value: m.cancelled, title: `${m.month}: ${m.cancelled} cancelled` }))} />
                  </Card>

                  <Card title="Accepted punches per day" sub="all companies, last 30 days">
                    {d.punchesPerDay.every((p) => p.punches === 0) ? (
                      <Empty title="No punches in the last 30 days" icon="clock" />
                    ) : (
                      <Bars data={d.punchesPerDay.map((p) => ({ label: p.date.slice(8), value: p.punches, title: `${date(p.date)}: ${p.punches.toLocaleString('en-LK')} punches` }))} />
                    )}
                  </Card>

                  <Card title="Most active companies" sub="punches received in 30 days" pad={false}>
                    {d.mostActive.length === 0 ? (
                      <div className="card-b muted small">No punches yet.</div>
                    ) : (
                      d.mostActive.map((m, i) => (
                        <div className="list-row" key={m.tenantId}>
                          <span className="muted small" style={{ width: 18 }}>
                            {i + 1}
                          </span>
                          <div className="bd">
                            <Link href={`/admin/tenants/${m.tenantId}`}>
                              <b>{m.name}</b>
                            </Link>
                          </div>
                          <span className="nowrap">{m.punches30d.toLocaleString('en-LK')}</span>
                        </div>
                      ))
                    )}
                  </Card>
                </div>

                <div className="stack">
                  <Card title="Trials ending soon" sub="within 14 days" pad={false}>
                    {d.trialsEnding.length === 0 ? (
                      <div className="card-b muted small">No trials end in the next 14 days.</div>
                    ) : (
                      d.trialsEnding.map((x) => {
                        const left = daysLeft(x.trialEndsAt);
                        return (
                          <div className="list-row" key={x.id}>
                            <div className="bd">
                              <Link href={`/admin/tenants/${x.id}`}>
                                <b>{x.name}</b>
                              </Link>
                              <span>
                                Ends {date(x.trialEndsAt)} · {x.employees} employees
                              </span>
                            </div>
                            <Chip tone={left !== null && left <= 3 ? 'bad' : 'warn'}>{left === null ? '—' : left < 0 ? 'Ended' : left === 0 ? 'Today' : `${left} d`}</Chip>
                          </div>
                        );
                      })
                    )}
                  </Card>

                  <Card title="Near the plan limit" sub="90% of employees allowed or more" pad={false}>
                    {d.nearLimit.length === 0 ? (
                      <div className="card-b muted small">No company is close to its plan limit.</div>
                    ) : (
                      d.nearLimit.map((x) => (
                        <div className="list-row" key={x.id}>
                          <div className="bd">
                            <Link href={`/admin/tenants/${x.id}`}>
                              <b>{x.name}</b>
                            </Link>
                            <span>
                              {x.plan} · {x.employees} of {x.max}
                            </span>
                            <div style={{ marginTop: 5 }}>
                              <Progress value={x.employees} max={x.max} tone={x.employees >= x.max ? 'bad' : 'warn'} />
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </Card>

                  <Card title="Terminals" sub={`${terminalTotal} in all`} pad={false} actions={<LinkButton href="/admin/terminals" size="sm">Open</LinkButton>}>
                    {terminalTotal === 0 ? (
                      <div className="card-b muted small">No terminals registered yet.</div>
                    ) : (
                      ['ALLOCATED', 'IN_STOCK', 'REPAIR', 'RETIRED'].map((s) => (
                        <div className="list-row" key={s}>
                          <span className={`dot ${s === 'ALLOCATED' ? 'ok' : s === 'REPAIR' ? 'warn' : s === 'IN_STOCK' ? 'info' : ''}`} />
                          <div className="bd">{label(s)}</div>
                          <b>{d.terminals[s] ?? 0}</b>
                        </div>
                      ))
                    )}
                  </Card>
                </div>
              </div>
            </>
          );
        }}
      </Async>
    </>
  );
}
