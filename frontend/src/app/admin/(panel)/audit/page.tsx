'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/hooks';
import { dateTime } from '@/lib/format';
import { Async, Button, Card, Empty, PageHeader, Pager, Select } from '@/components/ui';
import type { TenantList } from '../_admin';

interface AuditRow {
  id: string;
  adminId: string | null;
  admin: { name: string; email: string } | null;
  action: string;
  tenantId: string | null;
  entity: string | null;
  entityId: string | null;
  detail: unknown;
  ip: string | null;
  createdAt: string;
}

const PAGE_SIZE = 50;

export default function PlatformAuditPage() {
  const [page, setPage] = useState(1);
  const [tenantId, setTenantId] = useState('');
  const [adminId, setAdminId] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const { data, error, loading } = useApi<{ rows: AuditRow[]; total: number }>('/platform/audit', { page, pageSize: PAGE_SIZE, tenantId, adminId });
  const tenants = useApi<TenantList>('/platform/tenants', { pageSize: 200 });
  const admins = useApi<{ id: string; name: string; email: string }[]>('/platform/admins');
  const nameOf = new Map((tenants.data?.rows ?? []).map((t) => [t.id, t.name]));

  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <>
      <PageHeader title="Platform audit" sub="Everything Lumi AI admins did: logins, company changes, support sessions, terminals, invoices and settings." />
      <Card pad={false}>
        <div className="filters">
          <Select
            value={tenantId}
            onChange={(e) => {
              setTenantId(e.target.value);
              setPage(1);
            }}
            placeholder="All companies"
            options={(tenants.data?.rows ?? []).map((t) => ({ value: t.id, label: t.name }))}
          />
          <Select
            value={adminId}
            onChange={(e) => {
              setAdminId(e.target.value);
              setPage(1);
            }}
            placeholder="All admins"
            options={(admins.data ?? []).map((a) => ({ value: a.id, label: a.name }))}
          />
          {data && <span className="muted small" style={{ marginLeft: 'auto' }}>{data.total} entries</span>}
        </div>
        <Async data={data} error={error} loading={loading}>
          {(d) =>
            d.rows.length === 0 ? (
              <Empty title="No audit entries" icon="shield" />
            ) : (
              <>
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Admin</th>
                        <th>Action</th>
                        <th>Company</th>
                        <th>Entity</th>
                        <th>IP</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {d.rows.map((r) => {
                        const hasDetail = r.detail !== null && r.detail !== undefined;
                        return (
                          <Fragment key={r.id}>
                            <tr>
                              <td className="nowrap">{dateTime(r.createdAt)}</td>
                              <td>{r.admin ? <span title={r.admin.email}>{r.admin.name}</span> : <span className="muted">System</span>}</td>
                              <td className="mono">{r.action}</td>
                              <td>
                                {r.tenantId ? (
                                  <Link href={`/admin/tenants/${r.tenantId}`}>{nameOf.get(r.tenantId) ?? <span className="mono small">{r.tenantId}</span>}</Link>
                                ) : (
                                  <span className="muted">—</span>
                                )}
                              </td>
                              <td className="small">
                                {r.entity ?? '—'}
                                {r.entityId && <div className="mono muted tiny">{r.entityId}</div>}
                              </td>
                              <td className="mono small">{r.ip ?? '—'}</td>
                              <td className="right">
                                {hasDetail && (
                                  <Button size="xs" variant="ghost" icon={open.has(r.id) ? 'chev-d' : 'chev-r'} onClick={() => toggle(r.id)}>
                                    Detail
                                  </Button>
                                )}
                              </td>
                            </tr>
                            {hasDetail && open.has(r.id) && (
                              <tr>
                                <td colSpan={7} style={{ background: 'var(--card-2)' }}>
                                  <pre className="mono small" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: 0 }}>
                                    {JSON.stringify(r.detail, null, 2)}
                                  </pre>
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
