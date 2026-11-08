'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';

export type Role = 'OWNER' | 'HR_MANAGER' | 'HR_OFFICER' | 'PAYROLL_OFFICER' | 'MANAGER' | 'EMPLOYEE';

export interface Me {
  user: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    role: Role;
    roleLabel: string;
    mustChangePassword: boolean;
    branchScope: string[];
    deptScope: string[];
    employee: null | {
      id: string;
      empNo: string;
      firstName: string;
      lastName: string;
      designation: string | null;
      photoPath: string | null;
      dob: string | null;
      birthdayOptOut: boolean;
      branch: { id: string; name: string } | null;
      department: { id: string; name: string } | null;
    };
  };
  tenant: {
    id: string;
    code: string;
    name: string;
    status: 'TRIAL' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
    isDemo: boolean;
    demoExpiresAt: string | null;
    trialEndsAt: string | null;
    hasLogo: boolean;
    plan: { code: string; name: string; maxEmployees: number; features: string[] };
    features: string[];
  };
  permissions: string[];
  isManager: boolean;
  makesRoster: boolean;
  support: null | { reasonType: string };
}

interface AuthState {
  me: Me | null;
  loading: boolean;
  reload: () => Promise<void>;
  can: (action: string) => boolean;
  has: (feature: string) => boolean;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setMe(await api.get<Me>('/me'));
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) console.error(e);
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const can = useCallback((a: string) => !!me?.permissions.includes(a), [me]);
  const has = useCallback((f: string) => !!me?.tenant.features.includes(f), [me]);
  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    window.location.href = '/login';
  }, []);

  return <Ctx.Provider value={{ me, loading, reload, can, has, logout }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}

/** Non-null `me` inside the console (the shell only renders pages once loaded). */
export function useMe(): Me {
  const { me } = useAuth();
  if (!me) throw new Error('Not signed in');
  return me;
}
