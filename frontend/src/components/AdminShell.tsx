'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { ADMIN_NAV } from '@/lib/nav';
import { Icon } from './Icon';
import { Avatar, Loading } from './ui';
import { Sidebar } from './Shell';

export interface PlatformMe {
  id: string;
  name: string;
  email: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT' | 'SALES';
}

const Ctx = createContext<PlatformMe | null>(null);
export function useAdmin(): PlatformMe {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAdmin outside AdminShell');
  return c;
}

export function AdminShell({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<PlatformMe | null>(null);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const path = usePathname();

  useEffect(() => {
    api
      .get<PlatformMe>('/platform/me')
      .then(setMe)
      .catch(() => router.replace(`/admin/login?next=${encodeURIComponent(path)}`));
  }, [router, path]);

  if (!me) return <Loading text="Opening Lumi AI admin…" />;
  const logout = async () => {
    await api.post('/platform/auth/logout').catch(() => undefined);
    window.location.href = '/admin/login';
  };

  return (
    <Ctx.Provider value={me}>
      <div className="shell">
        <Sidebar groups={ADMIN_NAV} open={open} onClose={() => setOpen(false)} tag="PLATFORM ADMIN" />
        <div className="main">
          <header className="top">
            <button className="burger" aria-label="Menu" onClick={() => setOpen(true)}>
              <Icon name="menu" />
            </button>
            <div className="company">
              <span>Lumi AI · SmartHR platform</span>
              <span className="chip mag">{me.role.replace('_', ' ').toLowerCase()}</span>
            </div>
            <span style={{ marginLeft: 'auto' }} />
            <div className="who">
              <Avatar name={me.name} />
              <div>
                <b>{me.name}</b>
                <span>{me.email}</span>
              </div>
              <button className="tbtn" title="Log out" aria-label="Log out" onClick={logout}>
                <Icon name="logout" />
              </button>
            </div>
          </header>
          <main className="page">{children}</main>
        </div>
      </div>
    </Ctx.Provider>
  );
}
