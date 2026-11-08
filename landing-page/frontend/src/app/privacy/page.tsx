import type { Metadata } from 'next';
import { LegalShell } from '@/components/LegalShell';
import { SITE } from '@/lib/site';

export const metadata: Metadata = { title: { absolute: 'Privacy policy · SmartHR by Lumi AI' } };

/** Public page. The App Store and Play Store link here. */
export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy policy" updated="November 2026" active="privacy">
      <h2>Who we are</h2>
      <p>SmartHR is an HR, attendance and payroll service run by {SITE.company}, Sri Lanka. Companies (“employers”) subscribe to SmartHR and create logins for their staff. The employer decides what data is kept about its staff; Lumi AI processes that data on the employer’s behalf.</p>

      <h2>What we collect</h2>
      <ul>
        <li><b>Account details</b> your employer enters: name, employee number, phone, email, job, department, branch, bank and EPF/ETF numbers, salary.</li>
        <li><b>Attendance</b>: the time you mark in and out, office or remote, and the device used.</li>
        <li><b>Location</b>: only at the moment you press Mark in or Mark out, and only when your employer requires it or you work remotely. We do not track location in the background.</li>
        <li><b>Leave, overtime, payslips, announcements, messages and asset requests</b> you or your employer create.</li>
        <li><b>Technical data</b>: app version, sign-in times and a notification token, used to keep your account secure.</li>
        <li><b>Website visitors</b>: if you contact us on WhatsApp or by email, we keep your message and contact details to reply to you.</li>
      </ul>

      <h2>How it is used</h2>
      <p>Only to run HR for your employer: attendance, rosters, leave, overtime, payroll, payslips and notices. We do not sell data, show ads or share data with advertisers.</p>

      <h2>Who can see it</h2>
      <p>Your employer’s authorised HR staff and your managers, according to the roles your employer sets. Lumi AI support staff can access an account only to fix a problem the employer reports, and every access is logged.</p>

      <h2>Where it is stored</h2>
      <p>On servers operated by Lumi AI, encrypted in transit (HTTPS). Passwords are stored as one-way hashes.</p>

      <h2>How long</h2>
      <p>While your employer uses SmartHR. Payroll, EPF and ETF records are kept for the period Sri Lankan law requires; other data is deleted when your employer removes it or closes its account.</p>

      <h2>Deleting your account</h2>
      <p>In the app, open <b>More → Delete my account</b>. The request goes to your employer’s HR, who close your login and delete or anonymise your personal data, except records the law requires them to keep. You can also email us at <a href={`mailto:${SITE.email}`}>{SITE.email}</a>.</p>

      <h2>Your rights</h2>
      <p>You can ask your employer, or us, to see, correct or delete your data, under the Personal Data Protection Act No. 9 of 2022 of Sri Lanka.</p>

      <h2>Contact</h2>
      <p>{SITE.company} · <a href={`mailto:${SITE.email}`}>{SITE.email}</a> · WhatsApp {SITE.phoneDisplay}</p>
    </LegalShell>
  );
}
