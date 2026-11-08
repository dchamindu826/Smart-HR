'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { api, errorMessage } from '@/lib/api';
import { AuthLayout } from '@/components/AuthLayout';
import { Alert, Button, Field, Input } from '@/components/ui';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ message: string }>('/auth/forgot-password', { email });
      setDone(r.message);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout>
      <img className="logo" src="/logo.png" alt="SmartHR by Lumi AI" />
      <h1>Reset your password</h1>
      <p className="muted" style={{ marginBottom: 20 }}>
        Enter your email. We will send a link to choose a new password. No email on your login? Ask HR to reset it.
      </p>
      {done ? (
        <Alert tone="ok">{done}</Alert>
      ) : (
        <form className="stack" onSubmit={submit}>
          <Field label="Email">
            <Input type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Alert>{error}</Alert>
          <Button type="submit" variant="pri" className="block" busy={busy}>
            Send reset link
          </Button>
        </form>
      )}
      <p className="small" style={{ marginTop: 18 }}>
        <Link href="/login">Back to log in</Link>
      </p>
    </AuthLayout>
  );
}
