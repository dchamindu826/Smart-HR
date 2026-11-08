'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { navFor, type NavGroup } from '@/lib/nav';
import { api, fileUrl } from '@/lib/api';
import { usePoll } from '@/lib/hooks';
import { ago, date } from '@/lib/format';
import { Icon } from './Icon';
import { Avatar, Loading } from './ui';

interface Notif {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark' | 'auto'>('auto');
  useEffect(() => {
    try {
      const t = localStorage.getItem('sh-theme') as 'light' | 'dark' | null;
      if (t) {
        setTheme(t);
        document.documentElement.dataset.theme = t;
      }
    } catch {
      /* storage blocked */
    }
  }, []);
  const cycle = () => {
    const next = theme === 'auto' ? 'dark' : theme === 'dark' ? 'light' : 'auto';
    setTheme(next);
    if (next === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
    try {
      if (next === 'auto') localStorage.removeItem('sh-theme');
      else localStorage.setItem('sh-theme', next);
    } catch {
      /* ignore */
    }
  };
  return { theme, cycle };
}

export function Sidebar({ groups, open, onClose, counts, tag }: { groups: NavGroup[]; open: boolean; onClose: () => void; counts?: Record<string, number>; tag?: string }) {
  const path = usePathname();
  const isOn = (href: string) => (href === '/admin' ? path === '/admin' : path === href || path.startsWith(href + '/'));
  return (
    <>
      <aside className={`rail ${open ? 'open' : ''}`}>
        <Link className="brand" href={tag ? '/admin' : '/dashboard'} onClick={onClose}>
          <img src="/logo.png" alt="SmartHR by Lumi AI" />
          {tag && <div className="tag">{tag}</div>}
        </Link>
        <nav className="nav">
          {groups.map((g) => (
            <div key={g.title}>
              <h2>{g.title}</h2>
              {g.items.map((i) => (
                <Link key={i.href} href={i.href} className={isOn(i.href) ? 'on' : ''} onClick={onClose}>
                  <Icon name={i.icon} />
                  <span>{i.label}</span>
                  {i.badge && counts?.[i.badge] ? <span className="ct">{counts[i.badge]}</span> : null}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="rail-foot">SmartHR by Lumi AI</div>
      </aside>
      <div className={`scrim ${open ? 'open' : ''}`} onClick={onClose} />
    </>
  );
}

function Bell() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ unread: number; rows: Notif[] }>({ unread: 0, rows: [] });
  const router = useRouter();
  const load = () => api.get<{ unread: number; rows: Notif[] }>('/notifications').then(setData).catch(() => undefined);
  useEffect(() => {
    load();
  }, []);
  usePoll(load, 60_000);
  const openItem = async (n: Notif) => {
    setOpen(false);
    if (!n.readAt) await api.post(`/notifications/${n.id}/read`).catch(() => undefined);
    load();
    if (n.link) router.push(n.link);
  };
  return (
    <div style={{ position: 'relative' }}>
      <button className="tbtn" aria-label="Notifications" onClick={() => setOpen(!open)}>
        <Icon name="bell" />
        {data.unread > 0 && <span className="bdg">{data.unread > 99 ? '99+' : data.unread}</span>}
      </button>
      {open && (
        <div className="pop notif">
          <div className="row between" style={{ padding: '10px 14px', borderBottom: '1px solid var(--rule)' }}>
            <b>Notifications</b>
            {data.unread > 0 && (
              <button className="linkbtn small" onClick={() => api.post('/notifications/read-all').then(load)}>
                Mark all read
              </button>
            )}
          </div>
          {data.rows.length === 0 && <div className="empty small">Nothing yet.</div>}
          {data.rows.map((n) => (
            <a key={n.id} className={`n ${n.readAt ? '' : 'unread'}`} href={n.link ?? '#'} onClick={(e) => { e.preventDefault(); openItem(n); }}>
              <b>{n.title}</b>
              {n.body && <span>{n.body}</span>}
              <div className="tiny faint">{ago(n.createdAt)}</div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export function ConsoleShell({ children }: { children: ReactNode }) {
  const { me, loading, logout } = useAuth();
  const router = useRouter();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const { theme, cycle } = useTheme();

  useEffect(() => {
    if (loading) return;
    if (!me) router.replace(`/login?next=${encodeURIComponent(path)}`);
    else if (me.user.mustChangePassword && !me.support) router.replace('/change-password');
  }, [me, loading, router, path]);

  const loadCounts = () => {
    if (!me) return;
    api.get<{ counts: { total: number } }>('/approvals').then((r) => setCounts((c) => ({ ...c, approvals: r.counts.total }))).catch(() => undefined);
    if (me.tenant.features.includes('messaging')) api.get<{ unread: number }>('/messages/unread').then((r) => setCounts((c) => ({ ...c, messages: r.unread }))).catch(() => undefined);
  };
  useEffect(loadCounts, [me]); // eslint-disable-line react-hooks/exhaustive-deps
  usePoll(loadCounts, 120_000);

  if (loading || !me) return <Loading text="Opening SmartHR…" />;
  const t = me.tenant;
  const daysLeft = (d: string | null) => (d ? Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000) : null);

  return (
    <div className="shell">
      <Sidebar groups={navFor(me)} open={open} onClose={() => setOpen(false)} counts={counts} />
      <div className="main">
        {me.support && (
          <div className="banner mag">
            <Icon name="eye" size={16} /> Lumi AI support view — read-only{me.support.reasonType !== 'PAYROLL' ? ', salary figures hidden' : ''}. Every page you open is recorded in the company audit log.
          </div>
        )}
        {t.status === 'SUSPENDED' && <div className="banner bad">This account is suspended. Staff can still mark attendance. Contact Lumi AI to reactivate.</div>}
        {t.isDemo && <div className="banner info">Demo account with sample data{t.demoExpiresAt ? ` · ends ${date(t.demoExpiresAt)}` : ''}. Remove the sample data in Company settings when you are ready to go live.</div>}
        {t.status === 'TRIAL' && !t.isDemo && t.trialEndsAt && (
          <div className="banner warn">
            Free trial · {Math.max(0, daysLeft(t.trialEndsAt) ?? 0)} days left. Contact Lumi AI to activate your {t.plan.name} plan.
          </div>
        )}
        <header className="top">
          <button className="burger" aria-label="Menu" onClick={() => setOpen(true)}>
            <Icon name="menu" />
          </button>
          <div className="company">
            {t.hasLogo && <img src={fileUrl('/settings/company/logo')} alt="" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />}
            <span>{t.name}</span>
            <span className="chip info">{t.plan.name}</span>
          </div>
          <span style={{ marginLeft: 'auto' }} />
          <button className="tbtn" aria-label="Theme" title={`Theme: ${theme}`} onClick={cycle}>
            <Icon name={theme === 'dark' ? 'moon' : 'sun'} />
          </button>
          <Bell />
          <div className="who" style={{ cursor: 'pointer' }} onClick={() => setMenu(!menu)}>
            <Avatar name={me.user.name} photoEmployeeId={me.user.employee?.id} />
            <div>
              <b>{me.user.name}</b>
              <span>{me.user.roleLabel}</span>
            </div>
            {menu && (
              <div className="pop" onClick={(e) => e.stopPropagation()}>
                <Link className="item" href="/profile" onClick={() => setMenu(false)}>
                  <Icon name="user" size={16} /> My profile
                </Link>
                <Link className="item" href="/change-password" onClick={() => setMenu(false)}>
                  <Icon name="key" size={16} /> Change password
                </Link>
                <div className="sep" />
                <button className="item" onClick={logout}>
                  <Icon name="logout" size={16} /> Log out
                </button>
              </div>
            )}
          </div>
        </header>
        <main className="page">{children}</main>
      </div>
    </div>
  );
}
