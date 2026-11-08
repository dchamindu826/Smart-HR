'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { date, money, today } from '@/lib/format';
import { Alert, Async, Button, Card, Chip, Empty, ErrorBox, Field, Input, PageHeader, useUi } from '@/components/ui';
import { useAdmin } from '@/components/AdminShell';
import { moneyInput, roleCan } from '../_admin';

interface Setting {
  key: string;
  value: number | string;
  note: string;
  isDefault: boolean;
}
interface TaxBand {
  id: string;
  effectiveFrom: string;
  sortOrder: number;
  fromAmount: string;
  toAmount: string | null;
  ratePct: string;
}
interface SystemResp {
  settings: Setting[];
  taxBands: TaxBand[];
}

const LABELS: Record<string, string> = {
  'epf.employeePct': 'EPF — employee %',
  'epf.employerPct': 'EPF — employer %',
  'etf.employerPct': 'ETF — employer %',
  'stampDuty.threshold': 'Stamp duty threshold (Rs)',
  'stampDuty.amount': 'Stamp duty amount (Rs)',
  'gratuity.minEmployees': 'Gratuity — minimum employees',
};

export default function SystemPage() {
  const me = useAdmin();
  const isSuper = roleCan(me.role);
  const { data, error, loading, reload } = useApi<SystemResp>('/platform/system');
  const [editor, setEditor] = useState(false);

  return (
    <>
      <PageHeader title="Statutory & tax" sub="Rates every company's payroll uses. Changes apply to payroll runs calculated after you save." />
      <div className="stack">
        <Alert tone="warn">Verify every figure against the current Inland Revenue and EPF/ETF rules before running live payroll.</Alert>
        <Async data={data} error={error} loading={loading}>
          {(d) => {
            const groups = new Map<string, TaxBand[]>();
            for (const b of d.taxBands) groups.set(b.effectiveFrom, [...(groups.get(b.effectiveFrom) ?? []), b]);
            const dates = [...groups.keys()].sort().reverse();
            const latest = dates[0] ? groups.get(dates[0])!.slice().sort((a, b) => a.sortOrder - b.sortOrder) : [];
            return (
              <>
                <Card title="Statutory values" sub={isSuper ? 'edit a value and press Save' : 'only a super admin can change these'} pad={false}>
                  {d.settings.map((s) => (
                    <SettingRow key={s.key} s={s} canEdit={isSuper} onSaved={reload} />
                  ))}
                </Card>

                <Card
                  title="APIT monthly tax table"
                  sub="the table with the latest start date on or before the pay period is used"
                  actions={
                    isSuper &&
                    !editor && (
                      <Button size="sm" variant="pri" onClick={() => setEditor(true)}>
                        New tax table
                      </Button>
                    )
                  }
                  pad={false}
                >
                  {editor && (
                    <div className="card-b" style={{ borderBottom: '1px solid var(--rule)' }}>
                      <TaxEditor
                        start={latest}
                        onClose={() => setEditor(false)}
                        onSaved={() => {
                          setEditor(false);
                          reload();
                        }}
                      />
                    </div>
                  )}
                  {dates.length === 0 ? (
                    <Empty title="No tax table" icon="scale">
                      Without a table, no APIT is deducted.
                    </Empty>
                  ) : (
                    dates.map((dt, i) => {
                      const rows = groups.get(dt)!.slice().sort((a, b) => a.sortOrder - b.sortOrder);
                      return (
                        <div key={dt} style={{ borderTop: i ? '1px solid var(--rule)' : undefined }}>
                          <div className="row" style={{ padding: '10px 16px 0' }}>
                            <b>From {date(dt)}</b>
                            {i === 0 && <Chip tone={dt <= today() ? 'ok' : 'info'}>{dt <= today() ? 'In use' : 'Starts later'}</Chip>}
                            {i === 1 && dates[0] > today() && <Chip tone="ok">In use</Chip>}
                          </div>
                          <div className="tbl-wrap">
                            <table className="tbl">
                              <thead>
                                <tr>
                                  <th>Band</th>
                                  <th className="num">From (Rs / month)</th>
                                  <th className="num">To (Rs / month)</th>
                                  <th className="num">Rate</th>
                                </tr>
                              </thead>
                              <tbody>
                                {rows.map((b, j) => (
                                  <tr key={b.id}>
                                    <td>{j + 1}</td>
                                    <td className="num">{money(b.fromAmount)}</td>
                                    <td className="num">{b.toAmount ? money(b.toAmount) : 'No limit'}</td>
                                    <td className="num">{Number(b.ratePct)}%</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })
                  )}
                </Card>
              </>
            );
          }}
        </Async>
      </div>
    </>
  );
}

function SettingRow({ s, canEdit, onSaved }: { s: Setting; canEdit: boolean; onSaved: () => void }) {
  const { toast } = useUi();
  const act = useAction();
  const isMoney = typeof s.value === 'string';
  const [v, setV] = useState(String(s.value));
  const [err, setErr] = useState<string | null>(null);
  const changed = v.trim() !== String(s.value);

  const save = async () => {
    setErr(null);
    let value: number | string;
    if (isMoney) {
      const m = moneyInput(v);
      if (!m) return setErr('Enter an amount like 25000.00.');
      value = m;
    } else {
      const n = Number(v);
      if (v.trim() === '' || !Number.isFinite(n) || n < 0) return setErr('Enter a number, 0 or more.');
      if (s.key.endsWith('Pct') && n > 100) return setErr('A percentage cannot be above 100.');
      if (s.key === 'gratuity.minEmployees' && !Number.isInteger(n)) return setErr('Enter a whole number.');
      value = n;
    }
    const r = await act.run(() => api.put(`/platform/system/${encodeURIComponent(s.key)}`, { value }));
    if (r !== undefined) {
      toast(`${LABELS[s.key] ?? s.key} saved.`);
      onSaved();
    }
  };

  return (
    <div className="list-row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div className="bd" style={{ minWidth: 220 }}>
        <b>{LABELS[s.key] ?? s.key}</b>
        <span>
          {s.note} · <span className="mono">{s.key}</span> {s.isDefault && <Chip>Default</Chip>}
        </span>
        {(err || act.error) && <div className="small bad-t" style={{ marginTop: 4 }}>{err ?? act.error}</div>}
      </div>
      <div className="row tight" style={{ flexWrap: 'nowrap' }}>
        <Input inputMode="decimal" value={v} disabled={!canEdit} onChange={(e) => setV(e.target.value)} style={{ width: 140, textAlign: 'right' }} />
        <span className="small muted" style={{ width: 22 }}>{isMoney ? 'Rs' : s.key.endsWith('Pct') ? '%' : ''}</span>
        {canEdit && (
          <Button size="sm" variant="pri" busy={act.busy} disabled={!changed} onClick={save}>
            Save
          </Button>
        )}
      </div>
    </div>
  );
}

interface Row {
  from: string;
  to: string;
  rate: string;
}

function TaxEditor({ start, onClose, onSaved }: { start: TaxBand[]; onClose: () => void; onSaved: () => void }) {
  const { toast, confirm } = useUi();
  const act = useAction();
  const [eff, setEff] = useState(today());
  const [rows, setRows] = useState<Row[]>(
    start.length
      ? start.map((b) => ({ from: b.fromAmount, to: b.toAmount ?? '', rate: String(Number(b.ratePct)) }))
      : [{ from: '0.00', to: '', rate: '0' }],
  );
  const [err, setErr] = useState<string | null>(null);

  // The "from" of every row after the first is the previous row's "to", so the table is always continuous.
  const view = rows.map((r, i) => ({ ...r, from: i === 0 ? r.from : rows[i - 1].to }));

  const setRow = (i: number, k: keyof Row, v: string) => setRows((x) => x.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const add = () => setRows((x) => [...x, { from: '', to: '', rate: '' }]);
  const remove = (i: number) => setRows((x) => x.filter((_, j) => j !== i));

  const validate = (): { fromAmount: string; toAmount: string | null; ratePct: string }[] | string => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eff)) return 'Choose the date the table takes effect.';
    const out: { fromAmount: string; toAmount: string | null; ratePct: string }[] = [];
    for (let i = 0; i < view.length; i++) {
      const r = view[i];
      const from = moneyInput(r.from);
      if (!from) return i === 0 ? 'Band 1: enter the lower amount (usually 0.00).' : `Band ${i + 1}: band ${i} needs an upper amount.`;
      const to = moneyInput(r.to);
      if (to === undefined) return `Band ${i + 1}: enter the upper amount like 100000.00.`;
      if (to === null && i < view.length - 1) return `Band ${i + 1}: only the last band can have no upper amount.`;
      if (to !== null && Number(to) <= Number(from)) return `Band ${i + 1}: the upper amount must be above the lower amount.`;
      const rate = r.rate.trim();
      if (!/^\d+(\.\d{1,2})?$/.test(rate) || Number(rate) > 100) return `Band ${i + 1}: the rate must be 0 to 100.`;
      out.push({ fromAmount: from, toAmount: to, ratePct: rate });
    }
    return out;
  };

  const save = async () => {
    setErr(null);
    const bands = validate();
    if (typeof bands === 'string') return setErr(bands);
    if ((await confirm({ title: `Save the tax table from ${date(eff)}?`, body: `${bands.length} bands. A table with the same start date is replaced. Payroll calculated from then on uses it.`, ok: 'Save table' })) === false) return;
    const r = await act.run(() => api.put('/platform/system-tax-table', { effectiveFrom: eff, bands }));
    if (r !== undefined) {
      toast('Tax table saved.');
      onSaved();
    }
  };

  return (
    <div className="stack">
      <ErrorBox error={err ?? act.error} />
      <Field label="Effective from" required hint="Usually 1 April, the start of the tax year.">
        <Input type="date" value={eff} onChange={(e) => setEff(e.target.value)} style={{ maxWidth: 200 }} />
      </Field>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Band</th>
              <th>From (Rs / month)</th>
              <th>To (Rs / month)</th>
              <th>Rate %</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {view.map((r, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>
                  <Input inputMode="decimal" value={r.from} disabled={i > 0} title={i > 0 ? 'Starts where the band above ends' : undefined} onChange={(e) => setRow(i, 'from', e.target.value)} />
                </td>
                <td>
                  <Input inputMode="decimal" value={r.to} placeholder={i === view.length - 1 ? 'Blank = no limit' : ''} onChange={(e) => setRow(i, 'to', e.target.value)} />
                </td>
                <td>
                  <Input inputMode="decimal" value={r.rate} onChange={(e) => setRow(i, 'rate', e.target.value)} style={{ maxWidth: 100 }} />
                </td>
                <td>{view.length > 1 && <Button size="xs" variant="ghost" icon="trash" aria-label="Remove band" onClick={() => remove(i)} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row">
        <Button size="sm" onClick={add} disabled={rows.length >= 20}>
          Add band
        </Button>
        <span className="grow" />
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="pri" busy={act.busy} onClick={save}>
          Save tax table
        </Button>
      </div>
    </div>
  );
}
