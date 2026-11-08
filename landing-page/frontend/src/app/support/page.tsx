import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalShell } from '@/components/LegalShell';
import { SITE, whatsappLink } from '@/lib/site';

export const metadata: Metadata = { title: { absolute: 'Support · SmartHR by Lumi AI' } };

/** Public support page (App Store "Support URL"). */
export default function SupportPage() {
  return (
    <LegalShell title="Support" active="support">
      <h2>Can’t sign in?</h2>
      <p>SmartHR accounts are created by your employer. If you forgot your password, use “Forgot password” on the login screen or ask your company’s HR to reset it.</p>
      <h2>Contact us</h2>
      <ul>
        <li>WhatsApp: <a href={whatsappLink('Hi Lumi AI, I need help with SmartHR.')} target="_blank" rel="noopener noreferrer">{SITE.phoneDisplay}</a></li>
        <li>Email: <a href={`mailto:${SITE.email}`}>{SITE.email}</a></li>
      </ul>
      <p>We answer on Sri Lankan working days.</p>
      <h2>Delete your account</h2>
      <p>In the app: <b>More → Delete my account</b>. See the <Link href="/privacy">privacy policy</Link> for what happens next.</p>
    </LegalShell>
  );
}
