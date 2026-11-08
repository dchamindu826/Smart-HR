'use client';

import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import { AuthLayout } from '@/components/AuthLayout';
import { Alert, Button, Field, Input } from '@/components/ui';

function ResetForm() {
  const token = useSearchParams().get('token') ?? '';
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw !== pw2) return setError('The two passwords do not match.');
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/reset-password', { token, password: pw });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout>
      <img className="logo" src="/logo.png" alt="SmartHR by Lumi AI" />
      <h1>Choose a new password</h1>
      {done ? (
        <div className="stack" style={{ marginTop: 16 }}>
          <Alert tone="ok">Your password is changed. Log in with the new one.</Alert>
          <Link className="btn pri" href="/login">
            Log in
          </Link>
        </div>
      ) : (
        <form className="stack" onSubmit={submit} style={{ marginTop: 16 }}>
          <Field label="New password" hint="At least 8 characters, with letters and a number.">
            <Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={8} />
          </Field>
          <Field label="Type it again">
            <Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
          </Field>
          <Alert>{error}</Alert>
          <Button type="submit" variant="pri" className="block" busy={busy} disabled={!token}>
            Save password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

export default function ResetPassword() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
