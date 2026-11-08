import { Suspense, type ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth';
import { ConsoleShell } from '@/components/Shell';
import { Loading, UiProvider } from '@/components/ui';

// Every console page depends on the signed-in user: never pre-render at build time.
export const dynamic = 'force-dynamic';

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <UiProvider>
        <ConsoleShell>
          <Suspense fallback={<Loading />}>{children}</Suspense>
        </ConsoleShell>
      </UiProvider>
    </AuthProvider>
  );
}
