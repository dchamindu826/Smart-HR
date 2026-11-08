'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { AuthLayout } from '@/components/AuthLayout';
import { Alert, Button, Field, Input } from '@/components/ui';

function AdminLoginForm() {
  const sp = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needCode, setNeedCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/platform/auth/login', { email, password, code: code || undefined });
      const next = sp.get('next');
      window.location.href = next && next.startsWith('/admin') ? next : '/admin';
    } catch (err) {
      if (err instanceof ApiError && (err.details as { code?: string } | undefined)?.code === 'TOTP_REQUIRED') {
        setNeedCode(true);
        setError(null);
      } else setError(err instanceof Error ? err.message : 'Could not log in.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout>
      <img className="logo" src="/logo.png" alt="SmartHR by Lumi AI" />
      <h1>Lumi AI admin</h1>
      <p className="muted" style={{ marginBottom: 20 }}>
        Platform administration. Company users log in at <a href="/login">/login</a>.
      </p>
      <form className="stack" onSubmit={submit}>
        <Field label="Email">
          <Input type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        {needCode && (
          <Field label="6-digit code from your authenticator app">
            <Input inputMode="numeric" autoFocus maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          </Field>
        )}
        <Alert>{error}</Alert>
        <Button type="submit" variant="pri" className="block" busy={busy}>
          Log in
        </Button>
      </form>
    </AuthLayout>
  );
}

export default function AdminLogin() {
  return (
    <Suspense>
      <AdminLoginForm />
    </Suspense>
  );
}
