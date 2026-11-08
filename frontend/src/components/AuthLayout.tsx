import type { ReactNode } from 'react';

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <div className="side">
        <img src="/mark.png" alt="" style={{ width: 64, filter: 'brightness(1.4)' }} />
        <div>
          <h2>Smarter people. Stronger businesses.</h2>
          <p>Attendance, roster, leave, overtime and payroll for Sri Lankan companies — in one place, at a small monthly price.</p>
          <ul>
            <li>Mark in from the phone, office or remote, with GPS</li>
            <li>EPF, ETF, APIT and payslips done right</li>
            <li>Rosters, leave and overtime approved in one inbox</li>
          </ul>
        </div>
        <small style={{ opacity: 0.6 }}>© Lumi AI · Sri Lanka</small>
      </div>
      <div className="form">
        <div className="box">{children}</div>
      </div>
    </div>
  );
}
