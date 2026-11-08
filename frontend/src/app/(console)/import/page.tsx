'use client';

import { useRef, useState, type DragEvent } from 'react';
import Link from 'next/link';
import { api, download } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { dateTime, label } from '@/lib/format';
import { Alert, Async, Button, Card, Check, Chip, Empty, ErrorBox, Field, Input, PageHeader, Seg, Stat, StatusChip, useUi } from '@/components/ui';
import { Icon } from '@/components/Icon';

type Kind = 'EMPLOYEES' | 'LEAVE_BALANCES';
type ImportErr = { row: number; field: string; message: string };

interface Validation {
  id: string;
  status: 'VALIDATED' | 'FAILED' | 'COMMITTED';
  totalRows: number;
  okRows: number;
  errors: ImportErr[];
  ignoredColumns?: string[];
  preview: Record<string, unknown>[];
}
interface JobDetail {
  id: string;
  kind: string;
  status: 'VALIDATED' | 'FAILED' | 'COMMITTED';
  totalRows: number;
  okRows: number;
  errors: ImportErr[];
  preview: Record<string, unknown>[];
  createdAt: string;
  committedAt: string | null;
  file: { originalName: string } | null;
}
interface JobRow {
  id: string;
  kind: string;
  status: 'VALIDATED' | 'FAILED' | 'COMMITTED';
  totalRows: number;
  okRows: number;
  createdAt: string;
  committedAt: string | null;
  file: { originalName: string } | null;
}
type CommitResult = { created: number; logins: number } | { updated: number };

const COLUMNS: Record<Kind, { key: string; label: string }[]> = {
  EMPLOYEES: [
    { key: 'empNo', label: 'Emp No' },
    { key: 'firstName', label: 'First name' },
    { key: 'lastName', label: 'Last name' },
    { key: 'nic', label: 'NIC' },
    { key: 'phone', label: 'Mobile' },
    { key: 'email', label: 'Email' },
    { key: 'designation', label: 'Designation' },
    { key: 'employmentType', label: 'Type' },
    { key: 'joinDate', label: 'Joined' },
    { key: 'managerEmpNo', label: 'Manager' },
  ],
  LEAVE_BALANCES: [
    { key: 'empNo', label: 'Emp No' },
    { key: 'leaveCode', label: 'Leave code' },
    { key: 'year', label: 'Year' },
    { key: 'taken', label: 'Taken so far' },
    { key: 'adjustment', label: 'Adjustment' },
  ],
};
const KIND_LABEL: Record<string, string> = { EMPLOYEES: 'Employees', LEAVE_BALANCES: 'Leave balances' };

const cell = (v: unknown) => (v === null || v === undefined || v === '' ? <span className="faint">—</span> : String(v));

export default function ImportPage() {
  const { can, has } = useAuth();
  const { toast, confirm } = useUi();
  const [kind, setKind] = useState<Kind>('EMPLOYEES');
  const [result, setResult] = useState<(Validation & { kind: Kind; source: string }) | null>(null);
  const [sheetUrl, setSheetUrl] = useState('');
  const [drag, setDrag] = useState(false);
  const [createLogins, setCreateLogins] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const act = useAction();
  const history = useApi<JobRow[]>(can('import.run') && has('import') ? '/imports' : null);

  if (!has('import')) {
    return (
      <>
        <PageHeader title="Bulk import" />
        <Card>
          <Empty title="Bulk import is not in your plan" icon="upload">
            Upgrade the plan to import employees and leave balances from Excel or Google Sheets.
          </Empty>
        </Card>
      </>
    );
  }
  if (!can('import.run')) {
    return (
      <>
        <PageHeader title="Bulk import" />
        <Alert>You do not have permission to import data.</Alert>
      </>
    );
  }

  const changeKind = (k: Kind) => {
    setKind(k);
    setResult(null);
    act.setError(null);
  };

  const uploadFile = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.(xlsx|csv)$/i.test(file.name)) {
      act.setError('Use an Excel (.xlsx) or CSV file. Old .xls files: open in Excel and save as .xlsx.');
      return;
    }
    setResult(null);
    const r = await act.run(() => api.upload<Validation>(`/imports/upload/${kind}`, file));
    if (fileRef.current) fileRef.current.value = '';
    if (r !== undefined) {
      setResult({ ...r, kind, source: file.name });
      history.reload();
    }
  };

  const fromSheet = async () => {
    setResult(null);
    const r = await act.run(() => api.post<Validation>(`/imports/google-sheet/${kind}`, { url: sheetUrl.trim() }));
    if (r !== undefined) {
      setResult({ ...r, kind, source: 'Google Sheet' });
      history.reload();
    }
  };

  const openJob = async (id: string) => {
    const j = await act.run(() => api.get<JobDetail>(`/imports/${id}`));
    if (j !== undefined) {
      const k = (j.kind === 'LEAVE_BALANCES' ? 'LEAVE_BALANCES' : 'EMPLOYEES') as Kind;
      setKind(k);
      setResult({ id: j.id, status: j.status, totalRows: j.totalRows, okRows: j.okRows, errors: j.errors ?? [], preview: j.preview ?? [], kind: k, source: j.file?.originalName ?? 'Earlier upload' });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const commit = async () => {
    if (!result) return;
    const what = result.kind === 'EMPLOYEES' ? `${result.totalRows} employee${result.totalRows === 1 ? '' : 's'}` : `${result.totalRows} leave balance${result.totalRows === 1 ? '' : 's'}`;
    if ((await confirm({ title: `Import ${what}?`, body: result.kind === 'EMPLOYEES' ? 'New employee records are created. This cannot be undone in one step.' : 'Taken and adjustment values are replaced for these employees and leave types.', ok: 'Import' })) === false) return;
    const r = await act.run(() => api.post<CommitResult>(`/imports/${result.id}/commit`, result.kind === 'EMPLOYEES' ? { createLogins } : {}));
    if (r !== undefined) {
      if ('created' in r) toast(`${r.created} employee${r.created === 1 ? '' : 's'} imported${createLogins ? `, ${r.logins} app login${r.logins === 1 ? '' : 's'} created and emailed` : ''}.`);
      else toast(`${r.updated} leave balance${r.updated === 1 ? '' : 's'} updated.`);
      setResult({ ...result, status: 'COMMITTED' });
      history.reload();
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDrag(false);
    uploadFile(e.dataTransfer.files?.[0]);
  };

  return (
    <>
      <PageHeader
        title="Bulk import"
        sub="Bring in many records at once from Excel, CSV or a Google Sheet. Nothing is saved until you check the preview and press Import."
        actions={<Seg<Kind> options={[{ value: 'EMPLOYEES', label: 'Employees' }, { value: 'LEAVE_BALANCES', label: 'Leave balances' }]} value={kind} onChange={changeKind} />}
      />

      <div className="grid2">
        <div>
        <Card title="1. Download the template">
          <div className="stack">
            <p className="muted">
              {kind === 'EMPLOYEES'
                ? 'One row per employee. Only first name, last name and join date are required. Branch and department use the codes from Branches & departments. Dates as YYYY-MM-DD or DD/MM/YYYY.'
                : 'One row per employee and leave type: Emp No, leave code (e.g. ANNUAL), year, days taken so far and any adjustment brought forward.'}
            </p>
            <p className="small faint">Your own spreadsheet also works when the column headings match (e.g. “Surname”, “NIC No”, “Date of joining”).</p>
            <div>
              <Button icon="download" onClick={() => act.run(() => download(`/imports/template/${kind}`, undefined, `smarthr-${kind.toLowerCase()}-template.xlsx`))}>
                Download {KIND_LABEL[kind].toLowerCase()} template
              </Button>
            </div>
          </div>
        </Card>
        </div>

        <div>
        <Card title="2. Upload the file">
          <div className="stack">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileRef.current?.click()}
              style={{
                border: `2px dashed ${drag ? 'var(--blue)' : 'var(--rule-2)'}`,
                background: drag ? 'var(--info-bg)' : 'var(--card-2)',
                borderRadius: 10,
                padding: '22px 16px',
                textAlign: 'center',
                cursor: 'pointer',
              }}
            >
              <Icon name="upload" size={28} />
              <div style={{ fontWeight: 600, marginTop: 6 }}>{act.busy ? 'Checking the file…' : 'Drop an .xlsx or .csv file here, or click to choose'}</div>
              <div className="small muted">Up to 2,000 rows and 10 MB</div>
              <input ref={fileRef} type="file" hidden accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(e) => uploadFile(e.target.files?.[0])} />
            </div>
            <div className="row" style={{ gap: 8 }}>
              <span className="faint small" style={{ flex: 'none' }}>
                or
              </span>
              <hr style={{ flex: 1, border: 0, borderTop: '1px solid var(--rule)' }} />
            </div>
            <Field label="Google Sheets link" hint="In Google Sheets: Share → General access → “Anyone with the link” → Viewer. Then copy the link here.">
              <div className="row tight" style={{ flexWrap: 'nowrap' }}>
                <Input value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" />
                <Button variant="pri" busy={act.busy} disabled={!/docs\.google\.com\/spreadsheets\/d\//.test(sheetUrl)} onClick={fromSheet}>
                  Check
                </Button>
              </div>
            </Field>
          </div>
        </Card>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <ErrorBox error={act.error} />
      </div>

      {result && (
        <Card
          title={`3. Check and import — ${KIND_LABEL[result.kind]}`}
          sub={result.source}
          actions={<StatusChip status={result.status} labelText={result.status === 'VALIDATED' ? 'Ready' : result.status === 'FAILED' ? 'Has errors' : 'Imported'} />}
        >
          <div className="stack">
            <div className="stats" style={{ marginBottom: 0 }}>
              <Stat label="Rows in the file" value={result.totalRows} />
              <Stat label="Rows without errors" value={result.okRows} tone="ok" />
              <Stat label="Errors" value={result.errors.length} tone={result.errors.length ? 'bad' : 'ok'} />
            </div>

            {result.ignoredColumns && result.ignoredColumns.length > 0 && (
              <Alert tone="info">These columns were not recognised and are ignored: {result.ignoredColumns.join(', ')}.</Alert>
            )}

            {result.status === 'FAILED' && (
              <Alert tone="bad">Nothing has been imported. Fix the rows below in your file and upload it again — every row must pass before you can import.</Alert>
            )}
            {result.status === 'COMMITTED' && (
              <Alert tone="ok">
                This import is done.{' '}
                {result.kind === 'EMPLOYEES' ? <Link href="/employees">See the employees</Link> : <Link href="/leave">Open leave</Link>}
              </Alert>
            )}

            {result.errors.length > 0 && (
              <div className="tbl-wrap" style={{ border: '1px solid var(--rule)', borderRadius: 8, maxHeight: 360, overflowY: 'auto' }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th className="num">Row</th>
                      <th>Column</th>
                      <th>Problem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.errors.map((e, i) => (
                      <tr key={i}>
                        <td className="num">{e.row}</td>
                        <td className="nowrap">{e.field}</td>
                        <td className="bad-t">{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {result.preview.length > 0 && (
              <>
                <b>
                  Preview{result.preview.length < result.totalRows ? ` — first ${result.preview.length} of ${result.totalRows} rows` : ''}
                </b>
                <div className="tbl-wrap" style={{ border: '1px solid var(--rule)', borderRadius: 8 }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th className="num">Row</th>
                        {COLUMNS[result.kind].map((c) => (
                          <th key={c.key}>{c.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.preview.map((r, i) => {
                        const rowErr = result.errors.some((e) => e.row === i + 2);
                        return (
                          <tr key={i} style={rowErr ? { background: 'var(--bad-bg)' } : undefined}>
                            <td className="num faint">{i + 2}</td>
                            {COLUMNS[result.kind].map((c) => (
                              <td key={c.key} className="nowrap">
                                {c.key === 'employmentType' && typeof r[c.key] === 'string' ? label(r[c.key] as string) : cell(r[c.key])}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {result.status === 'VALIDATED' && (
              <div className="row between">
                {result.kind === 'EMPLOYEES' && can('employee.account') ? (
                  <Check checked={createLogins} onChange={setCreateLogins} label="Create app logins for new employees and email the details" />
                ) : (
                  <span />
                )}
                <Button variant="pri" icon="check" busy={act.busy} onClick={commit}>
                  Import {result.totalRows} row{result.totalRows === 1 ? '' : 's'}
                </Button>
              </div>
            )}
          </div>
        </Card>
      )}

      <div style={{ marginTop: 16 }}>
        <Card title="Earlier imports" pad={false}>
          <Async data={history.data} error={history.error} loading={history.loading}>
            {(rows) =>
              rows.length === 0 ? (
                <Empty title="No imports yet" icon="upload">
                  Uploaded files appear here with their result.
                </Empty>
              ) : (
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>What</th>
                        <th>File</th>
                        <th className="num">Rows</th>
                        <th className="num">Without errors</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((j) => (
                        <tr key={j.id}>
                          <td className="nowrap">{dateTime(j.createdAt)}</td>
                          <td>{KIND_LABEL[j.kind] ?? label(j.kind)}</td>
                          <td className="small muted">{j.file?.originalName ?? '—'}</td>
                          <td className="num">{j.totalRows}</td>
                          <td className="num">{j.okRows}</td>
                          <td>
                            <StatusChip status={j.status} labelText={j.status === 'VALIDATED' ? 'Not imported yet' : j.status === 'FAILED' ? 'Had errors' : 'Imported'} />
                            {j.committedAt && <span className="tiny faint"> {dateTime(j.committedAt)}</span>}
                          </td>
                          <td className="right">
                            <Button size="xs" onClick={() => openJob(j.id)}>
                              {j.status === 'VALIDATED' ? 'Review' : 'View'}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            }
          </Async>
        </Card>
      </div>
      <p className="small faint" style={{ marginTop: 10 }}>
        <Chip tone="info">Tip</Chip> Import branches and departments first (Setup → Branches &amp; departments), then employees, then leave balances.
      </p>
    </>
  );
}
