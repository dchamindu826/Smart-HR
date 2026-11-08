'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useApi, useDebounced } from '@/lib/hooks';
import { Select } from './ui';

export interface EmpLite {
  id: string;
  empNo: string;
  firstName: string;
  lastName: string;
  designation?: string | null;
}

/** Search-as-you-type employee picker. Value is the employee id. */
export function EmployeePicker({ value, onChange, placeholder = 'Search by name or number…', status, disabled }: { value: string | null; onChange: (id: string | null, e?: EmpLite) => void; placeholder?: string; status?: string; disabled?: boolean }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<EmpLite[]>([]);
  const [picked, setPicked] = useState<EmpLite | null>(null);
  const dq = useDebounced(q, 250);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!value) {
      setPicked(null);
      return;
    }
    if (picked?.id === value) return;
    api.get<EmpLite>(`/employees/${value}`).then(setPicked).catch(() => setPicked(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    if (!open) return;
    api.get<{ rows: EmpLite[] }>('/employees', { q: dq, pageSize: 20, status }).then((r) => setRows(r.rows)).catch(() => setRows([]));
  }, [dq, open, status]);

  useEffect(() => {
    const h = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <input
        className="input"
        disabled={disabled}
        value={open ? q : picked ? `${picked.firstName} ${picked.lastName} (${picked.empNo})` : ''}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);
          setQ('');
        }}
        onChange={(e) => setQ(e.target.value)}
      />
      {open && (
        <div className="pop" style={{ left: 0, right: 0, maxHeight: 280, overflowY: 'auto' }}>
          {value && (
            <button
              className="item"
              onClick={() => {
                onChange(null);
                setPicked(null);
                setOpen(false);
              }}
            >
              <span className="muted">Clear</span>
            </button>
          )}
          {rows.length === 0 && <div className="item muted">No matches</div>}
          {rows.map((r) => (
            <button
              key={r.id}
              className="item"
              onClick={() => {
                setPicked(r);
                onChange(r.id, r);
                setOpen(false);
              }}
            >
              <span>
                <b>
                  {r.firstName} {r.lastName}
                </b>{' '}
                <span className="muted small">
                  {r.empNo}
                  {r.designation ? ` · ${r.designation}` : ''}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface Named {
  id: string;
  name: string;
  code?: string;
}

export function BranchSelect({ value, onChange, placeholder = 'All branches', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  const { data } = useApi<Named[]>('/org/branches');
  return <Select className={className} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} options={(data ?? []).map((b) => ({ value: b.id, label: b.name }))} />;
}

export function DepartmentSelect({ value, onChange, placeholder = 'All departments', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  const { data } = useApi<Named[]>('/org/departments');
  return <Select className={className} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} options={(data ?? []).map((b) => ({ value: b.id, label: b.name }))} />;
}

export function UserSelect({ value, onChange, placeholder = 'Choose a user', roles, className }: { value: string; onChange: (v: string) => void; placeholder?: string; roles?: string[]; className?: string }) {
  const { data } = useApi<{ id: string; name: string; role: string; active: boolean }[]>('/settings/users', { active: 'true' });
  const list = (data ?? []).filter((u) => !roles || roles.includes(u.role));
  return <Select className={className} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} options={list.map((u) => ({ value: u.id, label: `${u.name} (${u.role.replace('_', ' ').toLowerCase()})` }))} />;
}
