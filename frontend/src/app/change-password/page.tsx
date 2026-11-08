'use client';

import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '@/lib/api';
import { AuthLayout } from '@/components/AuthLayout';
import { Alert, Button, Field, Input } from '@/components/ui';

export default function ChangePassword() {
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw !== pw2) return setError('The two new passwords do not match.');
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/change-password', { current: cur, next: pw });
      window.location.href = '/dashboard';
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout>
      <img className="logo" src="/logo.png" alt="SmartHR by Lumi AI" />
      <h1>Set your password</h1>
      <p className="muted" style={{ marginBottom: 20 }}>
        Choose a password only you know. You will use it from now on.
      </p>
      <form className="stack" onSubmit={submit}>
        <Field label="Current or temporary password">
          <Input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required />
        </Field>
        <Field label="New password" hint="At least 8 characters, with letters and a number.">
          <Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={8} />
        </Field>
        <Field label="Type the new password again">
          <Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
        </Field>
        <Alert>{error}</Alert>
        <Button type="submit" variant="grad" className="block" busy={busy}>
          Save and continue
        </Button>
      </form>
    </AuthLayout>
  );
}
