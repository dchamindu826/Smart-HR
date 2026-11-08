import type { Metadata } from 'next';
import { Landing } from '@/components/landing/Landing';

export const metadata: Metadata = {
  title: { absolute: 'SmartHR by Lumi AI — HR, attendance and payroll for Sri Lanka' },
  description: 'Attendance with GPS, rosters, leave, overtime and payroll with EPF, ETF and APIT — in one simple system with a mobile app for your staff. Made in Sri Lanka.',
  openGraph: {
    title: 'SmartHR by Lumi AI',
    description: 'HR, attendance and payroll for Sri Lankan businesses.',
    images: ['/logo.png'],
    type: 'website',
  },
};

/** Public landing page. Signed-in users use "Log in" to reach the console. */
export default function Home() {
  return <Landing />;
}
