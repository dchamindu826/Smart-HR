'use client';

import { useParams } from 'next/navigation';
import { download, fileUrl } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useApi } from '@/lib/hooks';
import { periodLabel } from '@/lib/format';
import { PayslipView, type SlipCompany, type SlipData, type SlipTemplate } from '@/components/PayslipView';
import { Alert, Async, Button, Chip, ErrorBox, LinkButton, Loading, PageHeader, StatusChip } from '@/components/ui';

/** GET /payslips/:id */
interface Payslip extends SlipData {
  id: string;
  status: 'DRAFT' | 'CALCULATED' | 'APPROVED' | 'LOCKED';
  released: boolean;
  employeeId: string;
  basic: string;
  epfEmployee: string;
  apit: string;
  stampDuty: string;
  warnings: string[];
}

/** GET /payroll/runs (only to find the run for the back link) */
interface RunLite {
  id: string;
  period: string;
}

export default function PayslipPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const act = useAction();
  const { data, error, loading } = useApi<Payslip>(`/payslips/${id}`);
  const tpl = useApi<SlipTemplate>('/payroll/template');
  const company = useApi<SlipCompany>('/settings/company');
  const runs = useApi<RunLite[]>(can('payroll.view') ? '/payroll/runs' : null);

  const run = data ? runs.data?.find((r) => r.period === data.period) : undefined;
  const backHref = run ? `/payroll/${run.id}` : '/payroll';

  return (
    <Async data={data} error={error} loading={loading}>
      {(s) => (
        <>
          <PageHeader
            crumbs={[
              { href: '/payroll', label: 'Payroll' },
              ...(run ? [{ href: backHref, label: periodLabel(s.period) }] : []),
            ]}
            title={`${s.snapshot.name} — ${periodLabel(s.period)}`}
            sub={
              <span className="row tight">
                <span className="mono">{s.snapshot.empNo}</span>
                {s.snapshot.designation && <span>· {s.snapshot.designation}</span>}
                <StatusChip status={s.status} />
                {s.released ? <Chip tone="ok">Visible to the employee</Chip> : <Chip>Not released</Chip>}
              </span>
            }
            actions={
              <>
                <LinkButton href={backHref} icon="chev-l">
                  Back to run
                </LinkButton>
                <Button icon="print" onClick={() => window.print()}>
                  Print
                </Button>
                <Button icon="eye" onClick={() => window.open(fileUrl(`/payslips/${s.id}/pdf`), '_blank', 'noopener')}>
                  Open PDF
                </Button>
                <Button variant="pri" icon="download" busy={act.busy} onClick={() => act.run(() => download(`/payslips/${s.id}/pdf`, { download: 1 }, `payslip-${s.period}-${s.snapshot.empNo}.pdf`))}>
                  Download PDF
                </Button>
              </>
            }
          />
          <ErrorBox error={act.error} />
          {s.warnings.length > 0 && (
            <div className="no-print" style={{ marginBottom: 14 }}>
              <Alert tone="warn">
                <b>Check before approving</b> (HR only — not printed on the payslip)
                <ul>
                  {s.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </Alert>
            </div>
          )}
          {s.status !== 'LOCKED' && (
            <div className="no-print" style={{ marginBottom: 14 }}>
              <Alert tone="info">This payslip is a preview. Figures can still change until the payroll is locked.</Alert>
            </div>
          )}
          <ErrorBox error={tpl.error} />
          {tpl.data ? <PayslipView slip={s} company={company.data} template={tpl.data} /> : tpl.loading ? <Loading /> : null}
        </>
      )}
    </Async>
  );
}
