'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useApi } from '@/lib/hooks';
import { label } from '@/lib/format';
import { Async, Button, Card, Check, Chip, ErrorBox, Field, Input, Modal, PageHeader, Select, useUi } from '@/components/ui';

type Rule = 'STATUTORY_ANNUAL' | 'STATUTORY_CASUAL' | 'FIXED' | 'MATERNITY' | 'NO_PAY';
interface LeaveType {
  id: string;
  code: string;
  name: string;
  paid: boolean;
  rule: Rule;
  daysPerYear: string | number;
  allowHalfDay: boolean;
  allowNegative: boolean;
  carryForwardMax: string | number;
  requireDocument: boolean;
  noticeDays: number;
  genderOnly: 'MALE' | 'FEMALE' | 'OTHER' | null;
  color: string;
  active: boolean;
  sortOrder: number;
}

const RULES: { value: Rule; label: string; help: string }[] = [
  { value: 'STATUTORY_ANNUAL', label: 'Annual (Shop & Office Act)', help: 'None in the joining year; next year 14/10/7/4 by quarter of joining; then 14.' },
  { value: 'STATUTORY_CASUAL', label: 'Casual (Shop & Office Act)', help: '7 a year; in the joining year 1 day per 2 completed months.' },
  { value: 'FIXED', label: 'Fixed days every year', help: 'The same number of days each year.' },
  { value: 'MATERNITY', label: 'Maternity', help: 'Days per the type (default 84 working days).' },
  { value: 'NO_PAY', label: 'No-pay', help: 'Unpaid; deducted in payroll.' },
];

const blank: Omit<LeaveType, 'id'> = { code: '', name: '', paid: true, rule: 'FIXED', daysPerYear: 0, allowHalfDay: true, allowNegative: false, carryForwardMax: 0, requireDocument: false, noticeDays: 0, genderOnly: null, color: '#0B6FD4', active: true, sortOrder: 10 };

export default function LeaveTypesPage() {
  const { can } = useAuth();
  const { data, error, loading, reload } = useApi<LeaveType[]>('/leave/types', { all: 1 });
  const [edit, setEdit] = useState<(Omit<LeaveType, 'id'> & { id?: string }) | null>(null);
  const act = useAction();
  const { toast } = useUi();
  const editable = can('leave.policy');

  const save = async () => {
    if (!edit) return;
    const { id, ...body } = edit;
    const payload = { ...body, daysPerYear: Number(body.daysPerYear), carryForwardMax: Number(body.carryForwardMax), code: body.code.trim().toUpperCase() };
    const r = await act.run(() => (id ? api.patch(`/leave/types/${id}`, payload) : api.post('/leave/types', payload)));
    if (r !== undefined) {
      toast('Leave type saved.');
      setEdit(null);
      reload();
    }
  };

  return (
    <>
      <PageHeader
        title="Leave types"
        sub="Balances are worked out from these rules each year. Statutory figures should be checked against the current Shop and Office Employees Act."
        actions={editable && <Button variant="pri" icon="leaf" onClick={() => setEdit({ ...blank })}>Add leave type</Button>}
      />
      <Async data={data} error={error} loading={loading}>
        {(rows) => (
          <Card pad={false}>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Leave</th>
                    <th>Rule</th>
                    <th className="num">Days / year</th>
                    <th>Paid</th>
                    <th>Half day</th>
                    <th className="num">Carry forward</th>
                    <th className="num">Notice</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <span className="chip" style={{ background: t.color + '22', color: t.color }}>{t.code}</span> <b>{t.name}</b>
                        {t.genderOnly && <span className="muted small"> · {label(t.genderOnly)} only</span>}
                      </td>
                      <td className="small">{RULES.find((r) => r.value === t.rule)?.label}</td>
                      <td className="num">{t.rule.startsWith('STATUTORY') ? 'By law' : Number(t.daysPerYear)}</td>
                      <td>{t.paid ? <Chip tone="ok">Paid</Chip> : <Chip tone="bad">No pay</Chip>}</td>
                      <td>{t.allowHalfDay ? 'Yes' : 'No'}</td>
                      <td className="num">{Number(t.carryForwardMax)}</td>
                      <td className="num">{t.noticeDays ? `${t.noticeDays} d` : '—'}</td>
                      <td>{t.active ? <Chip tone="ok">Active</Chip> : <Chip>Inactive</Chip>}</td>
                      <td className="right">{editable && <Button size="sm" onClick={() => setEdit({ ...t })}>Edit</Button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </Async>

      {edit && (
        <Modal
          title={edit.id ? `Edit ${edit.name}` : 'Add leave type'}
          onClose={() => setEdit(null)}
          footer={
            <>
              <Button onClick={() => setEdit(null)}>Cancel</Button>
              <Button variant="pri" busy={act.busy} onClick={save}>Save</Button>
            </>
          }
        >
          <div className="stack">
            <ErrorBox error={act.error} />
            <div className="form-grid">
              <Field label="Code" required hint="Short, e.g. MEDICAL">
                <Input value={edit.code} maxLength={12} onChange={(e) => setEdit({ ...edit, code: e.target.value })} />
              </Field>
              <Field label="Name" required>
                <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
              </Field>
              <Field label="Rule" wide hint={RULES.find((r) => r.value === edit.rule)?.help}>
                <Select value={edit.rule} onChange={(e) => setEdit({ ...edit, rule: e.target.value as Rule, paid: e.target.value !== 'NO_PAY' })} options={RULES.map((r) => ({ value: r.value, label: r.label }))} />
              </Field>
              {(edit.rule === 'FIXED' || edit.rule === 'MATERNITY') && (
                <Field label="Days per year">
                  <Input type="number" min={0} step={0.5} value={edit.daysPerYear} onChange={(e) => setEdit({ ...edit, daysPerYear: e.target.value })} />
                </Field>
              )}
              <Field label="Carry forward up to (days)">
                <Input type="number" min={0} step={0.5} value={edit.carryForwardMax} onChange={(e) => setEdit({ ...edit, carryForwardMax: e.target.value })} />
              </Field>
              <Field label="Notice needed (days)">
                <Input type="number" min={0} value={edit.noticeDays} onChange={(e) => setEdit({ ...edit, noticeDays: Number(e.target.value) })} />
              </Field>
              <Field label="Only for">
                <Select value={edit.genderOnly ?? ''} placeholder="Everyone" onChange={(e) => setEdit({ ...edit, genderOnly: (e.target.value || null) as LeaveType['genderOnly'] })} options={[{ value: 'FEMALE', label: 'Women' }, { value: 'MALE', label: 'Men' }]} />
              </Field>
              <Field label="Colour">
                <Input type="color" value={edit.color} onChange={(e) => setEdit({ ...edit, color: e.target.value.toUpperCase() })} />
              </Field>
            </div>
            <div className="row">
              <Check checked={edit.paid} onChange={(v) => setEdit({ ...edit, paid: v })} label="Paid" />
              <Check checked={edit.allowHalfDay} onChange={(v) => setEdit({ ...edit, allowHalfDay: v })} label="Half days allowed" />
              <Check checked={edit.allowNegative} onChange={(v) => setEdit({ ...edit, allowNegative: v })} label="Can go below zero" />
              <Check checked={edit.requireDocument} onChange={(v) => setEdit({ ...edit, requireDocument: v })} label="Needs a document" />
              <Check checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Active" />
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
