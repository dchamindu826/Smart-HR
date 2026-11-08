import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalShell } from '@/components/LegalShell';
import { SITE } from '@/lib/site';

export const metadata: Metadata = { title: { absolute: 'Terms and conditions · SmartHR by Lumi AI' } };

export default function TermsPage() {
  return (
    <LegalShell title="Terms and conditions" updated="November 2026" active="terms">
      <p>These terms are an agreement between {SITE.company} (“Lumi AI”, “we”) and the company that subscribes to SmartHR (“the customer”, “you”). By creating an account or using SmartHR you accept them. Employees who use SmartHR through their employer also agree to the parts that apply to users.</p>

      <h2>1. The service</h2>
      <p>SmartHR is online software for HR, attendance, rosters, leave, overtime and payroll, with a web console and an employee mobile app. We host and maintain it, and we may improve or change features from time to time. We will tell you before we remove a feature that your plan includes.</p>

      <h2>2. Accounts</h2>
      <ul>
        <li>You create logins for your staff and decide their roles. You are responsible for everything done under your company’s logins.</li>
        <li>Keep passwords private. Tell us at once if you think a login has been misused.</li>
        <li>You must give us correct company and contact details and keep them up to date.</li>
      </ul>

      <h2>3. Plans, fees and payment</h2>
      <ul>
        <li>Fees are as shown on our website or in your quotation, in Sri Lankan rupees, and are billed monthly or yearly in advance.</li>
        <li>Each plan has a maximum number of active employees. If you go over it, we will ask you to move to the right plan.</li>
        <li>If an invoice is not paid within 14 days of its due date, we may suspend the account after giving notice. Staff can still mark attendance while an account is suspended, but HR features are read-only.</li>
        <li>We may change prices with at least 30 days’ notice. The new price applies from your next billing period.</li>
        <li>Fees already paid are not refundable, except where the law requires it or we end the service without cause.</li>
      </ul>

      <h2>4. Free demo and trial</h2>
      <p>A demo or trial account is for evaluation only. It may contain sample data and may be deleted when the trial ends unless you subscribe.</p>

      <h2>5. Your data</h2>
      <ul>
        <li>You own the data you put into SmartHR. We process it only to provide the service, as described in our <Link href="/privacy">privacy policy</Link>.</li>
        <li>You confirm you have the right to give us your employees’ data and that you have told them how it is used, as required by the Personal Data Protection Act No. 9 of 2022.</li>
        <li>You can export your data at any time while your account is active. After the account ends we keep it for 90 days so you can export it, then delete it, except records we must keep by law.</li>
      </ul>

      <h2>6. Payroll and statutory figures</h2>
      <p>SmartHR calculates salary, EPF, ETF, APIT and other figures from the settings and data you enter. You remain responsible for checking payroll before you approve it and for submitting returns and payments to the authorities on time. We keep statutory rates up to date as they are published, but we are not your accountant or legal adviser.</p>

      <h2>7. Acceptable use</h2>
      <p>You must not use SmartHR to break any law, to store data you have no right to hold, to try to reach another company’s data, to test or attack its security without our written permission, or to resell it without an agreement with us.</p>

      <h2>8. Availability and support</h2>
      <p>We aim to keep SmartHR available at all times, but there may be planned maintenance (we will try to do it outside Sri Lankan working hours) and occasional unplanned outages. Support is given by WhatsApp and email on Sri Lankan working days.</p>

      <h2>9. Liability</h2>
      <p>To the extent the law allows, we are not liable for indirect or consequential loss, such as lost profit or penalties caused by incorrect data entered into the system. Our total liability in any 12 months is limited to the fees you paid us in those 12 months. Nothing in these terms limits liability that cannot be limited by law.</p>

      <h2>10. Ending the agreement</h2>
      <p>You can cancel at any time; the account stays active until the end of the period you have paid for. We can end the agreement if you seriously break these terms and do not fix it within 14 days of our notice.</p>

      <h2>11. Changes to these terms</h2>
      <p>We may update these terms. We will show the date of the latest version on this page and tell account owners about important changes before they take effect.</p>

      <h2>12. Law</h2>
      <p>These terms are governed by the laws of the Democratic Socialist Republic of Sri Lanka, and the courts of Colombo have jurisdiction.</p>

      <h2>13. Contact</h2>
      <p>{SITE.company} · {SITE.address} · <a href={`mailto:${SITE.email}`}>{SITE.email}</a> · WhatsApp {SITE.phoneDisplay}</p>
    </LegalShell>
  );
}
