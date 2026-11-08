'use client';

import { Fragment, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useApi, useDebounced } from '@/lib/hooks';
import { dateTime } from '@/lib/format';
import { Icon } from '@/components/Icon';
import { Async, Button, Card, Empty, Input, PageHeader, Pager, Select } from '@/components/ui';

/** GET /audit */
interface AuditRow {
  id: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
}
interface AuditPage {
  rows: AuditRow[];
  total: number;
}

const ENTITIES = [
  'Employee', 'User', 'Tenant', 'Branch', 'Department', 'PayrollRun', 'LeaveRequest', 'OvertimeClaim', 'AttendanceSession',
  'RosterWeek', 'HolidayDate', 'Asset', 'Announcement', 'ImportJob',
];
const PAGE_SIZE = 50;

function Json({ title, value }: { title: string; value: unknown }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="tiny faint" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
        {title}
      </div>
      {value === null || value === undefined ? (
        <div className="small faint">—</div>
      ) : (
        <pre className="mono" style={{ margin: 0, fontSize: 11.5, background: 'var(--card)', border: '1px solid var(--rule)', borderRadius: 6, padding: 8, maxHeight: 320, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default function AuditPage() {
  const sp = useSearchParams();
  const [entity, setEntity] = useState(sp.get('entity') ?? '');
  const [entityId, setEntityId] = useState(sp.get('entityId') ?? '');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const dAction = useDebounced(action.trim(), 300);
  const dEntityId = useDebounced(entityId.trim(), 300);

  const { data, error, loading } = useApi<AuditPage>('/audit', { entity, entityId: dEntityId, action: dAction, from, to, page, pageSize: PAGE_SIZE });
  const reset = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };
  const filtered = !!(entity || entityId || action || from || to);

  return (
    <>
      <PageHeader title="Audit log" sub="Who changed what, and when. The log is append-only — entries are never edited or deleted." />
      <Card pad={false}>
        <div className="filters">
          <Select value={entity} onChange={(e) => reset(setEntity)(e.target.value)} placeholder="All records" options={ENTITIES.map((e) => ({ value: e, label: e }))} />
          <Input className="mono" placeholder="Action starts with… e.g. payroll." value={action} onChange={(e) => reset(setAction)(e.target.value)} style={{ minWidth: 200 }} />
          <Input className="mono" placeholder="Record id" value={entityId} onChange={(e) => reset(setEntityId)(e.target.value)} style={{ minWidth: 160 }} />
          <span className="row tight small muted">
            From <Input type="date" value={from} max={to || undefined} onChange={(e) => reset(setFrom)(e.target.value)} style={{ minWidth: 0 }} />
            to <Input type="date" value={to} min={from || undefined} onChange={(e) => reset(setTo)(e.target.value)} style={{ minWidth: 0 }} />
          </span>
          {filtered && (
            <Button
              size="sm"
              variant="ghost"
              icon="x"
              onClick={() => {
                setEntity('');
                setEntityId('');
                setAction('');
                setFrom('');
                setTo('');
                setPage(1);
              }}
            >
              Clear
            </Button>
          )}
        </div>
        <Async data={data} error={error} loading={loading}>
          {(d) =>
            d.rows.length === 0 ? (
              <Empty title="No entries" icon="shield">
                {filtered ? 'Nothing matches these filters.' : 'Changes appear here as people use SmartHR.'}
              </Empty>
            ) : (
              <>
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th style={{ width: 28 }} />
                        <th>Time</th>
                        <th>By</th>
                        <th>Action</th>
                        <th>Record</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.rows.map((r) => {
                        const isOpen = open === r.id;
                        const hasDetail = r.before != null || r.after != null || !!r.ip;
                        return (
                          <Fragment key={r.id}>
                            <tr className={hasDetail ? 'click' : undefined} onClick={() => hasDetail && setOpen(isOpen ? null : r.id)}>
                              <td>{hasDetail && <Icon name={isOpen ? 'chev-d' : 'chev-r'} size={14} />}</td>
                              <td className="nowrap small">{dateTime(r.createdAt)}</td>
                              <td>
                                {r.actorName ?? <span className="faint">{r.actorId === 'system' ? 'System' : r.actorId?.startsWith('platform:') ? 'Lumi AI support' : '—'}</span>}
                              </td>
                              <td className="mono">{r.action}</td>
                              <td>
                                <span>{r.entity}</span>
                                {r.entityId && (
                                  <span className="mono tiny faint" style={{ marginLeft: 6 }}>
                                    {r.entityId}
                                  </span>
                                )}
                              </td>
                            </tr>
                            {isOpen && (
                              <tr>
                                <td />
                                <td colSpan={4} style={{ background: 'var(--card-2)' }}>
                                  <div className="grid2">
                                    <Json title="Before" value={r.before} />
                                    <Json title="After" value={r.after} />
                                  </div>
                                  {r.ip && <div className="tiny faint" style={{ marginTop: 6 }}>IP {r.ip}</div>}
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Pager page={page} pageSize={PAGE_SIZE} total={d.total} onPage={setPage} />
              </>
            )
          }
        </Async>
      </Card>
    </>
  );
}
