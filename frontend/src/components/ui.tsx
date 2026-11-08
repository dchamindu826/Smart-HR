'use client';

/**
 * The UI kit. Every screen uses these so the console looks the same everywhere.
 * Plain CSS classes are in app/globals.css.
 */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes, type ButtonHTMLAttributes } from 'react';
import Link from 'next/link';
import { Icon, type IconKey } from './Icon';
import { initials } from '@/lib/format';
import { fileUrl } from '@/lib/api';

// ─── layout ───────────────────────────────────────────────────

export function PageHeader({ title, sub, actions, crumbs }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; crumbs?: { href: string; label: string }[] }) {
  return (
    <div className="ph">
      <div>
        {crumbs && (
          <div className="crumbs">
            {crumbs.map((c, i) => (
              <span key={c.href}>
                {i > 0 && ' / '}
                <Link href={c.href}>{c.label}</Link>
              </span>
            ))}
          </div>
        )}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="acts">{actions}</div>}
    </div>
  );
}

export function Card({ title, sub, actions, children, footer, pad = true, className }: { title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children?: ReactNode; footer?: ReactNode; pad?: boolean; className?: string }) {
  return (
    <section className={`card ${className ?? ''}`}>
      {(title || actions) && (
        <div className="card-h">
          {title && <h2>{title}</h2>}
          {sub && <span className="sub">{sub}</span>}
          {actions && <div className="sp">{actions}</div>}
        </div>
      )}
      {pad ? <div className="card-b">{children}</div> : children}
      {footer && <div className="card-f">{footer}</div>}
    </section>
  );
}

export function Stat({ label, value, sub, tone, href }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'mag'; href?: string }) {
  const body = (
    <>
      <span>{label}</span>
      <b>{value}</b>
      {sub && <small>{sub}</small>}
    </>
  );
  return href ? (
    <Link href={href} className={`stat ${tone ?? ''}`}>
      {body}
    </Link>
  ) : (
    <div className={`stat ${tone ?? ''}`}>{body}</div>
  );
}

// ─── buttons ──────────────────────────────────────────────────

type BtnVariant = 'pri' | 'grad' | 'ok' | 'danger' | 'ghost' | '';
export function Button({ variant = '', size, icon, busy, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'xs'; icon?: IconKey; busy?: boolean }) {
  return (
    <button type="button" className={`btn ${variant} ${size ?? ''} ${className ?? ''}`} disabled={busy || rest.disabled} {...rest}>
      {busy ? <span className="spinner" style={{ width: 14, height: 14 }} /> : icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}

export function LinkButton({ href, variant = '', size, icon, children }: { href: string; variant?: BtnVariant; size?: 'sm' | 'xs'; icon?: IconKey; children: ReactNode }) {
  return (
    <Link href={href} className={`btn ${variant} ${size ?? ''}`}>
      {icon && <Icon name={icon} />}
      {children}
    </Link>
  );
}

// ─── chips, avatar, person ────────────────────────────────────

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'mag' | '';
export function Chip({ tone = '', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`chip ${tone}`} title={title}>
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: 'ok', APPROVED: 'ok', PRESENT: 'ok', IN: 'ok', PUBLISHED: 'ok', LOCKED: 'ok', PAID: 'ok', FILED: 'ok', SETTLED: 'ok', COMMITTED: 'ok', ALLOCATED: 'ok', VALIDATED: 'info',
  PENDING: 'warn', SUBMITTED: 'warn', NEEDS_REASON: 'warn', DRAFT: 'info', CALCULATED: 'info', TRIAL: 'info', DUE: 'warn', INCOMPLETE: 'warn', HALF_LEAVE: 'info', PROBATION: 'info', PREPARED: 'info', RETURNED: 'warn', REPAIR: 'warn', IN_STOCK: 'info', ASSIGNED: 'mag',
  REJECTED: 'bad', ABSENT: 'bad', NOT_IN: 'bad', SUSPENDED: 'bad', CANCELLED: '', TERMINATED: 'bad', RESIGNED: '', FAILED: 'bad', VOID: '', LOST: 'bad', RETIRED: '',
  LEAVE: 'mag', HOLIDAY: 'mag', OFF: '',
};
export function StatusChip({ status, labelText }: { status: string; labelText?: string }) {
  const t = status.toLowerCase().replace(/_/g, ' ');
  return <Chip tone={STATUS_TONE[status] ?? ''}>{labelText ?? t[0].toUpperCase() + t.slice(1)}</Chip>;
}

export function Avatar({ name, photoEmployeeId, size }: { name: string; photoEmployeeId?: string | null; size?: 'lg' }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`avatar ${size ?? ''}`}>
      {photoEmployeeId && !failed ? <img src={fileUrl(`/employees/${photoEmployeeId}/photo`)} alt="" onError={() => setFailed(true)} /> : initials(name)}
    </span>
  );
}

export function Person({ name, sub, href, photoEmployeeId }: { name: string; sub?: ReactNode; href?: string; photoEmployeeId?: string | null }) {
  const inner = (
    <div className="person">
      <Avatar name={name} photoEmployeeId={photoEmployeeId} />
      <div style={{ minWidth: 0 }}>
        <b>{name}</b>
        {sub && <small>{sub}</small>}
      </div>
    </div>
  );
  return href ? (
    <Link href={href} style={{ color: 'inherit', textDecoration: 'none' }}>
      {inner}
    </Link>
  ) : (
    inner
  );
}

// ─── states ───────────────────────────────────────────────────

export function Loading({ text = 'Loading…' }: { text?: string }) {
  return (
    <div className="loading">
      <span className="spinner" /> {text}
    </div>
  );
}

export function Empty({ title, children, icon = 'inbox', action }: { title: string; children?: ReactNode; icon?: IconKey; action?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} />
      <b>{title}</b>
      {children && <div className="small">{children}</div>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

export function Alert({ tone = 'bad', children }: { tone?: 'bad' | 'warn' | 'ok' | 'info'; children: ReactNode }) {
  if (!children) return null;
  return (
    <div className={`alert ${tone}`} role={tone === 'bad' ? 'alert' : undefined}>
      <div>{children}</div>
    </div>
  );
}

export function ErrorBox({ error }: { error: string | null | undefined }) {
  return error ? <Alert tone="bad">{error}</Alert> : null;
}

/** Shows loading / error / content in one go. */
export function Async<T>({ data, error, loading, children }: { data: T | null; error: string | null; loading: boolean; children: (d: T) => ReactNode }) {
  if (error && !data) return <Alert>{error}</Alert>;
  if (!data) return loading ? <Loading /> : null;
  return <>{children(data)}</>;
}

// ─── form fields ──────────────────────────────────────────────

export function Field({ label, hint, error, required, children, wide }: { label: ReactNode; hint?: ReactNode; error?: string | null; required?: boolean; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`field ${wide ? 'wide' : ''}`}>
      <label>
        {label}
        {required && <span className="req"> *</span>}
      </label>
      {children}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="err">{error}</span>}
    </div>
  );
}

export function Input(p: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={`input ${p.className ?? ''}`} />;
}

export function Select({ options, placeholder, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <select {...p} className={`select ${p.className ?? ''}`}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Textarea(p: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={`textarea ${p.className ?? ''}`} />;
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="tr" />
      {label}
    </label>
  );
}

export function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={t.value === value} className={t.value === value ? 'on' : ''} onClick={() => onChange(t.value)}>
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className="ct">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Seg<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)} type="button">
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="pager">
      <span>
        {(page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)} of {total}
      </span>
      <div className="row tight">
        <Button size="sm" icon="chev-l" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

// ─── modal ────────────────────────────────────────────────────

export function Modal({ title, onClose, children, footer, size }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'wide' | 'narrow' }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size ?? ''}`} role="dialog" aria-modal="true">
        <div className="modal-h">
          <h2>{title}</h2>
          <button className="tbtn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}

// ─── toasts and confirm ───────────────────────────────────────

interface ToastItem {
  id: number;
  text: string;
  tone: '' | 'ok' | 'bad';
}
interface UiState {
  toast: (text: string, tone?: '' | 'ok' | 'bad') => void;
  confirm: (o: { title: string; body?: ReactNode; ok?: string; danger?: boolean; input?: { label: string; placeholder?: string; minLength?: number } }) => Promise<false | string>;
}
const UiCtx = createContext<UiState | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [dlg, setDlg] = useState<null | (Parameters<UiState['confirm']>[0] & { resolve: (v: false | string) => void })>(null);
  const [text, setText] = useState('');

  const toast = useCallback((t: string, tone: '' | 'ok' | 'bad' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((x) => [...x, { id, text: t, tone }]);
    setTimeout(() => setToasts((x) => x.filter((i) => i.id !== id)), tone === 'bad' ? 7000 : 3800);
  }, []);
  const confirm = useCallback<UiState['confirm']>(
    (o) =>
      new Promise((resolve) => {
        setText('');
        setDlg({ ...o, resolve });
      }),
    [],
  );
  const close = (v: false | string) => {
    dlg?.resolve(v);
    setDlg(null);
  };
  const tooShort = !!dlg?.input && text.trim().length < (dlg.input.minLength ?? 1);

  return (
    <UiCtx.Provider value={{ toast, confirm }}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
      {dlg && (
        <Modal
          title={dlg.title}
          size="narrow"
          onClose={() => close(false)}
          footer={
            <>
              <Button onClick={() => close(false)}>Cancel</Button>
              <Button variant={dlg.danger ? 'danger' : 'pri'} className={dlg.danger ? 'solid' : ''} disabled={tooShort} onClick={() => close(dlg.input ? text.trim() : 'ok')}>
                {dlg.ok ?? 'Confirm'}
              </Button>
            </>
          }
        >
          <div className="stack">
            {dlg.body && <div className="muted">{dlg.body}</div>}
            {dlg.input && (
              <Field label={dlg.input.label} hint={dlg.input.minLength ? `At least ${dlg.input.minLength} characters.` : undefined}>
                <Textarea autoFocus value={text} placeholder={dlg.input.placeholder} onChange={(e) => setText(e.target.value)} />
              </Field>
            )}
          </div>
        </Modal>
      )}
    </UiCtx.Provider>
  );
}

export function useUi(): UiState {
  const c = useContext(UiCtx);
  if (!c) throw new Error('useUi outside UiProvider');
  return c;
}

// ─── small charts ─────────────────────────────────────────────

export function Bars({ data, max, tone }: { data: { label: string; value: number; title?: string }[]; max?: number; tone?: 'mag' }) {
  const m = max ?? Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="bars">
      {data.map((d, i) => (
        <div className="b" key={i} title={d.title ?? `${d.label}: ${d.value}`}>
          <i className={tone ?? ''} style={{ height: `${Math.max(2, (d.value / m) * 100)}%` }} />
          <small>{d.label}</small>
        </div>
      ))}
    </div>
  );
}

export function HBars({ data, format }: { data: { label: string; value: number }[]; format?: (n: number) => string }) {
  const m = Math.max(1, ...data.map((d) => d.value));
  return (
    <div>
      {data.map((d) => (
        <div className="hbar" key={d.label}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</span>
          <div className="bar">
            <i style={{ width: `${(d.value / m) * 100}%` }} />
          </div>
          <span className="right">{format ? format(d.value) : d.value}</span>
        </div>
      ))}
    </div>
  );
}

export function Progress({ value, max, tone }: { value: number; max: number; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <div className={`bar ${tone ?? ''}`}>
      <i style={{ width: `${Math.min(100, max ? (value / max) * 100 : 0)}%` }} />
    </div>
  );
}
