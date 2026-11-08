'use client';

import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { AuthLayout } from '@/components/AuthLayout';
import { Alert, Button, Field, Input, Select } from '@/components/ui';

function LoginForm() {
  const sp = useSearchParams();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [company, setCompany] = useState('');
  const [companies, setCompanies] = useState<{ code: string; name: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ mustChangePassword: boolean }>('/auth/login', { login, password, company: company || undefined, client: 'web' });
      const next = sp.get('next');
      window.location.href = r.mustChangePassword ? '/change-password' : next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
    } catch (err) {
      if (err instanceof ApiError && (err.details as { code?: string } | undefined)?.code === 'COMPANY_REQUIRED') {
        setCompanies((err.details as { companies: { code: string; name: string }[] }).companies);
      }
      setError(err instanceof Error ? err.message : 'Could not log in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <img className="logo" src="/logo.png" alt="SmartHR by Lumi AI" />
      <h1>Log in</h1>
      <p className="muted" style={{ marginBottom: 20 }}>
        For HR, managers and payroll. Employees use the SmartHR app.
      </p>
      <form className="stack" onSubmit={submit}>
        <Field label="Email or mobile number">
          <Input autoFocus autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} required />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        {companies && (
          <Field label="Company">
            <Select value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Choose your company" options={companies.map((c) => ({ value: c.code, label: c.name }))} />
          </Field>
        )}
        <Alert>{error}</Alert>
        <Button type="submit" variant="grad" className="block" busy={busy}>
          Log in
        </Button>
        <div className="row between small">
          <Link href="/forgot-password">Forgot password?</Link>
          <Link href="/admin/login" className="faint">
            Lumi AI admin
          </Link>
        </div>
      </form>
    </AuthLayout>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
