import type { ReactNode } from 'react';
import Link from 'next/link';
import { SITE } from '@/lib/site';
import '@/components/landing/landing.css';

/** Header and footer for the public legal pages (terms, privacy, support). */
export function LegalShell({ title, updated, active, children }: { title: string; updated?: string; active: 'terms' | 'privacy' | 'support'; children: ReactNode }) {
  return (
    <div className="legal-page">
      <header className="legal-top">
        <div className="lp-wrap">
          <Link href="/"><img src="/logo.png" alt="SmartHR by Lumi AI" /></Link>
          <nav>
            <Link href="/" className="hide-sm">Home</Link>
            <Link href="/terms" className={active === 'terms' ? 'on' : ''}>Terms</Link>
            <Link href="/privacy" className={active === 'privacy' ? 'on' : ''}>Privacy</Link>
            <Link href="/support" className={active === 'support' ? 'on' : ''}>Support</Link>
          </nav>
        </div>
      </header>
      <section className="legal-hero">
        <div className="lp-wrap" style={{ maxWidth: 820 }}>
          <h1>{title}</h1>
          {updated && <p>Last updated: {updated}</p>}
        </div>
      </section>
      <main className="legal-body">
        <article className="legal-card">{children}</article>
      </main>
      <footer className="legal-foot">
        <div className="lp-wrap">
          <span>© {new Date().getFullYear()} {SITE.company}</span>
          <span><Link href="/terms">Terms</Link> · <Link href="/privacy">Privacy</Link> · <Link href="/support">Support</Link></span>
        </div>
      </footer>
    </div>
  );
}
