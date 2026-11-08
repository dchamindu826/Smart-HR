import { Suspense, type ReactNode } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { Loading, UiProvider } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <UiProvider>
      <AdminShell>
        <Suspense fallback={<Loading />}>{children}</Suspense>
      </AdminShell>
    </UiProvider>
  );
}
