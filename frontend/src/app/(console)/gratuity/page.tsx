'use client';

import { useState } from 'react';
import { download } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { date, money, moneyShort, today } from '@/lib/format';
import { Alert, Async, Button, Card, Chip, Empty, ErrorBox, Field, Input, PageHeader, Person, Stat } from '@/components/ui';

/** GET /gratuity?asOf */
interface Gratuity {
  asOf: string;
  actApplies: boolean;
  headcount: number;
  totals: { liability: string; payable: string; eligible: number };
  rows: {
    employee: { id: string; empNo: string; name: string; designation: string | null; department: string | null };
    joinDate: string;
    years: number;
    eligible: boolean;
    salary: string;
    liability: string;
    payable: string;
  }[];
}

export default function GratuityPage() {
  const [asOf, setAsOf] = useState(today());
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(asOf);
  const { data, error, loading } = useApi<Gratuity>(valid ? '/gratuity' : null, { asOf });
  const act = useAction();

  return (
    <>
      <PageHeader
        title="Gratuity"
        sub="Half a month's last salary (basic + EPF-applicable fixed allowances) for each completed year of service, payable after 5 years. Based on the Payment of Gratuity Act No. 12 of 1983 — verify against the Act before paying."
        actions={
          <Button icon="download" busy={act.busy} disabled={!valid} onClick={() => act.run(() => download('/gratuity/export.xlsx', { asOf }, `gratuity-${asOf}.xlsx`))}>
            Export Excel
          </Button>
        }
      />
      <ErrorBox error={act.error} />
      <Card pad={false}>
        <div className="filters">
          <Field label="As of">
            <Input type="date" value={asOf} max="2100-12-31" onChange={(e) => setAsOf(e.target.value)} />
          </Field>
          {asOf !== today() && (
            <Button size="sm" variant="ghost" onClick={() => setAsOf(today())}>
              Today
            </Button>
          )}
        </div>
      </Card>
      <div style={{ height: 16 }} />
      <Async data={data} error={error} loading={loading}>
        {(g) => (
          <>
            {!g.actApplies && (
              <div style={{ marginBottom: 14 }}>
                <Alert tone="info">
                  The Gratuity Act applies to employers with 15 or more workers; you have {g.headcount}. The liability is still shown here for your books.
                </Alert>
              </div>
            )}
            <div className="stats">
              <Stat label="Total liability" value={moneyShort(g.totals.liability)} sub={`Rs ${money(g.totals.liability)} accrued`} />
              <Stat label="Payable now" value={moneyShort(g.totals.payable)} sub="if eligible people left today" tone="warn" />
              <Stat label="Eligible employees" value={g.totals.eligible} sub={`5+ years, of ${g.rows.length} active`} tone="ok" />
            </div>
            <Card pad={false} title={`Liability as of ${date(g.asOf)}`} sub="amounts in Rs">
              {g.rows.length === 0 ? (
                <Empty title="No active employees" icon="scale" />
              ) : (
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>No</th>
                        <th>Name</th>
                        <th>Joined</th>
                        <th className="num">Years</th>
                        <th className="num">Monthly salary</th>
                        <th className="num">Liability</th>
                        <th className="num">Payable now</th>
                        <th>Eligible</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map((r) => (
                        <tr key={r.employee.id}>
                          <td className="mono">{r.employee.empNo}</td>
                          <td>
                            <Person name={r.employee.name} sub={[r.employee.designation, r.employee.department].filter(Boolean).join(' · ')} href={`/employees/${r.employee.id}`} photoEmployeeId={r.employee.id} />
                          </td>
                          <td className="nowrap">{date(r.joinDate)}</td>
                          <td className="num">{r.years}</td>
                          <td className="num">{money(r.salary)}</td>
                          <td className="num">{money(r.liability)}</td>
                          <td className="num">
                            <b>{money(r.payable)}</b>
                          </td>
                          <td>{r.eligible ? <Chip tone="ok">Eligible</Chip> : <Chip>{Math.max(0, 5 - r.years)} yr to go</Chip>}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={5}>Total ({g.rows.length})</td>
                        <td className="num">{money(g.totals.liability)}</td>
                        <td className="num">{money(g.totals.payable)}</td>
                        <td>{g.totals.eligible} eligible</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </Async>
    </>
  );
}
