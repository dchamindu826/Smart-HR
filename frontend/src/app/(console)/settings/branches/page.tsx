'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { Alert, Async, Button, Card, Chip, Empty, ErrorBox, Field, Input, Modal, PageHeader, Select, Toggle, useUi } from '@/components/ui';
import { EmployeePicker } from '@/components/pickers';

interface Branch {
  id: string;
  code: string;
  name: string;
  address: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  radiusM: number;
  active: boolean;
  _count: { employees: number; departments: number; terminals: number };
}
interface Department {
  id: string;
  code: string;
  name: string;
  branchId: string | null;
  headId: string | null;
  active: boolean;
  branch: { id: string; name: string } | null;
  head: { id: string; firstName: string; lastName: string } | null;
  _count: { employees: number };
}

const CODE_RE = /^[A-Za-z0-9_-]+$/;

export default function BranchesSettingsPage() {
  const { can } = useAuth();
  const { toast, confirm } = useUi();
  const branches = useApi<Branch[]>('/org/branches', { all: '1' });
  const depts = useApi<Department[]>('/org/departments');
  const [branchEdit, setBranchEdit] = useState<Branch | 'new' | null>(null);
  const [deptEdit, setDeptEdit] = useState<Department | 'new' | null>(null);
  const act = useAction();
  const editable = can('org.edit');

  const delBranch = async (b: Branch) => {
    if ((await confirm({ title: `Remove branch ${b.name}?`, body: 'Only a branch with no employees, departments, terminals or attendance history can be removed. Otherwise make it inactive.', ok: 'Remove', danger: true })) === false) return;
    const r = await act.run(() => api.del(`/org/branches/${b.id}`));
    if (r !== undefined) {
      toast('Branch removed.');
      branches.reload();
    }
  };
  const delDept = async (d: Department) => {
    if ((await confirm({ title: `Remove department ${d.name}?`, body: 'Only a department with no employees can be removed. Otherwise make it inactive.', ok: 'Remove', danger: true })) === false) return;
    const r = await act.run(() => api.del(`/org/departments/${d.id}`));
    if (r !== undefined) {
      toast('Department removed.');
      depts.reload();
    }
  };

  return (
    <>
      <PageHeader title="Branches and departments" sub="Each branch can have a location fence, so office mark-ins are checked against where the branch is." />
      {!editable && <Alert tone="info">You can see branches and departments but not change them.</Alert>}
      <ErrorBox error={act.error} />

      <Card
        title="Branches"
        pad={false}
        actions={
          editable ? (
            <Button size="sm" variant="pri" icon="building" onClick={() => setBranchEdit('new')}>
              Add branch
            </Button>
          ) : undefined
        }
      >
        <Async data={branches.data} error={branches.error} loading={branches.loading}>
          {(rows) =>
            rows.length === 0 ? (
              <Empty title="No branches yet" icon="building">
                Add at least one branch — your head office counts.
              </Empty>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Name</th>
                      <th>Address</th>
                      <th>Location fence</th>
                      <th className="num">Employees</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((b) => (
                      <tr key={b.id}>
                        <td className="mono">{b.code}</td>
                        <td>
                          <b>{b.name}</b>
                          {b.phone && <div className="small muted">{b.phone}</div>}
                        </td>
                        <td className="small muted" style={{ maxWidth: 260 }}>
                          {b.address ?? '—'}
                        </td>
                        <td className="nowrap">
                          {b.lat !== null && b.lng !== null ? (
                            <a href={`https://maps.google.com/?q=${b.lat},${b.lng}`} target="_blank" rel="noreferrer" className="small">
                              {b.lat.toFixed(5)}, {b.lng.toFixed(5)} · {b.radiusM} m
                            </a>
                          ) : (
                            <Chip tone="warn">No fence</Chip>
                          )}
                        </td>
                        <td className="num">{b._count.employees}</td>
                        <td>{b.active ? <Chip tone="ok">Active</Chip> : <Chip>Inactive</Chip>}</td>
                        <td className="nowrap right">
                          {editable && (
                            <>
                              <Button size="xs" icon="edit" onClick={() => setBranchEdit(b)}>
                                Edit
                              </Button>{' '}
                              <Button size="xs" variant="danger" icon="trash" aria-label={`Remove ${b.name}`} onClick={() => delBranch(b)} />
                            </>
                          )}
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

      <Card
        title="Departments"
        pad={false}
        actions={
          editable ? (
            <Button size="sm" variant="pri" icon="layers" onClick={() => setDeptEdit('new')}>
              Add department
            </Button>
          ) : undefined
        }
      >
        <Async data={depts.data} error={depts.error} loading={depts.loading}>
          {(rows) =>
            rows.length === 0 ? (
              <Empty title="No departments yet" icon="layers">
                Departments are optional. Add them to group people, e.g. Finance, Sales, Production.
              </Empty>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Name</th>
                      <th>Branch</th>
                      <th>Head</th>
                      <th className="num">Employees</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((d) => (
                      <tr key={d.id}>
                        <td className="mono">{d.code}</td>
                        <td>
                          <b>{d.name}</b>
                        </td>
                        <td>{d.branch?.name ?? <span className="faint">All branches</span>}</td>
                        <td>{d.head ? `${d.head.firstName} ${d.head.lastName}` : <span className="faint">—</span>}</td>
                        <td className="num">{d._count.employees}</td>
                        <td>{d.active ? <Chip tone="ok">Active</Chip> : <Chip>Inactive</Chip>}</td>
                        <td className="nowrap right">
                          {editable && (
                            <>
                              <Button size="xs" icon="edit" onClick={() => setDeptEdit(d)}>
                                Edit
                              </Button>{' '}
                              <Button size="xs" variant="danger" icon="trash" aria-label={`Remove ${d.name}`} onClick={() => delDept(d)} />
                            </>
                          )}
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

      {branchEdit && (
        <BranchModal
          branch={branchEdit === 'new' ? null : branchEdit}
          onClose={() => setBranchEdit(null)}
          onDone={() => {
            setBranchEdit(null);
            branches.reload();
          }}
        />
      )}
      {deptEdit && (
        <DeptModal
          dept={deptEdit === 'new' ? null : deptEdit}
          branches={branches.data ?? []}
          onClose={() => setDeptEdit(null)}
          onDone={() => {
            setDeptEdit(null);
            depts.reload();
          }}
        />
      )}
    </>
  );
}

function BranchModal({ branch, onClose, onDone }: { branch: Branch | null; onClose: () => void; onDone: () => void }) {
  const [code, setCode] = useState(branch?.code ?? '');
  const [name, setName] = useState(branch?.name ?? '');
  const [address, setAddress] = useState(branch?.address ?? '');
  const [phone, setPhone] = useState(branch?.phone ?? '');
  const [lat, setLat] = useState(branch?.lat !== null && branch?.lat !== undefined ? String(branch.lat) : '');
  const [lng, setLng] = useState(branch?.lng !== null && branch?.lng !== undefined ? String(branch.lng) : '');
  const [radius, setRadius] = useState(String(branch?.radiusM ?? 150));
  const [active, setActive] = useState(branch?.active ?? true);
  const [locating, setLocating] = useState(false);
  const act = useAction();
  const { toast } = useUi();

  const latN = Number(lat);
  const lngN = Number(lng);
  const radN = Number(radius);
  const errs = {
    code: code.trim() && !CODE_RE.test(code.trim()) ? 'Letters, numbers, - and _ only.' : null,
    lat: lat.trim() && (!Number.isFinite(latN) || Math.abs(latN) > 90) ? 'Between -90 and 90.' : (lat.trim() === '') !== (lng.trim() === '') ? 'Give both, or neither.' : null,
    lng: lng.trim() && (!Number.isFinite(lngN) || Math.abs(lngN) > 180) ? 'Between -180 and 180.' : null,
    radius: !Number.isInteger(radN) || radN < 30 || radN > 5000 ? 'A whole number from 30 to 5000.' : null,
  };
  const ok = code.trim().length >= 1 && name.trim().length >= 2 && !errs.code && !errs.lat && !errs.lng && !errs.radius;
  const maps = lat.trim() && lng.trim() && !errs.lat && !errs.lng ? `https://maps.google.com/?q=${latN},${lngN}` : null;

  const locate = () => {
    if (!navigator.geolocation) {
      toast('This browser cannot share its location.', 'bad');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLat(p.coords.latitude.toFixed(6));
        setLng(p.coords.longitude.toFixed(6));
        setLocating(false);
        toast(`Location set (accuracy about ${Math.round(p.coords.accuracy)} m). Check it on the map.`);
      },
      (e) => {
        setLocating(false);
        toast(e.code === e.PERMISSION_DENIED ? 'Location permission was refused.' : 'Could not get your location.', 'bad');
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const save = async () => {
    const body = {
      code: code.trim().toUpperCase(),
      name: name.trim(),
      address: address.trim() || null,
      phone: phone.trim() || null,
      lat: lat.trim() ? latN : null,
      lng: lng.trim() ? lngN : null,
      radiusM: radN,
      active,
    };
    const r = await act.run(() => (branch ? api.patch(`/org/branches/${branch.id}`, body) : api.post('/org/branches', body)));
    if (r !== undefined) {
      toast(branch ? 'Branch saved.' : 'Branch added.');
      onDone();
    }
  };

  return (
    <Modal
      title={branch ? `Edit ${branch.name}` : 'Add a branch'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="pri" busy={act.busy} disabled={!ok} onClick={save}>
            {branch ? 'Save' : 'Add branch'}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Code" required hint="Short, e.g. HO or KDY. Used in imports." error={errs.code}>
          <Input value={code} maxLength={10} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        </Field>
        <Field label="Name" required>
          <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Address" wide>
          <Input value={address} maxLength={300} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <Field label="Phone">
          <Input type="tel" value={phone} maxLength={30} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Fence radius (metres)" error={errs.radius} hint="Mark-ins within this distance count as at the office.">
          <Input type="number" min={30} max={5000} step={10} value={radius} onChange={(e) => setRadius(e.target.value)} />
        </Field>
        <Field label="Latitude" error={errs.lat}>
          <Input inputMode="decimal" value={lat} placeholder="6.9271" onChange={(e) => setLat(e.target.value)} />
        </Field>
        <Field label="Longitude" error={errs.lng}>
          <Input inputMode="decimal" value={lng} placeholder="79.8612" onChange={(e) => setLng(e.target.value)} />
        </Field>
        <div className="field wide">
          <div className="row tight">
            <Button size="sm" icon="pin" busy={locating} onClick={locate}>
              Use my current location
            </Button>
            {maps && (
              <a className="btn sm ghost" href={maps} target="_blank" rel="noreferrer">
                Check on Google Maps
              </a>
            )}
          </div>
          <span className="hint">Stand at the branch entrance and press the button, or copy the numbers from Google Maps (right-click the spot). Leave empty for no fence.</span>
        </div>
        <div className="field wide">
          <Toggle checked={active} onChange={setActive} label="Active" />
          {!active && branch && branch._count.employees > 0 && <span className="err">Move the {branch._count.employees} employees to another branch first.</span>}
        </div>
        <div className="wide">
          <ErrorBox error={act.error} />
        </div>
      </div>
    </Modal>
  );
}

function DeptModal({ dept, branches, onClose, onDone }: { dept: Department | null; branches: Branch[]; onClose: () => void; onDone: () => void }) {
  const [code, setCode] = useState(dept?.code ?? '');
  const [name, setName] = useState(dept?.name ?? '');
  const [branchId, setBranchId] = useState(dept?.branchId ?? '');
  const [headId, setHeadId] = useState<string | null>(dept?.headId ?? null);
  const [active, setActive] = useState(dept?.active ?? true);
  const act = useAction();
  const { toast } = useUi();
  const codeErr = code.trim() && !CODE_RE.test(code.trim()) ? 'Letters, numbers, - and _ only.' : null;
  const ok = code.trim().length >= 1 && name.trim().length >= 2 && !codeErr;

  const save = async () => {
    const body = { code: code.trim().toUpperCase(), name: name.trim(), branchId: branchId || null, headId: headId || null, active };
    const r = await act.run(() => (dept ? api.patch(`/org/departments/${dept.id}`, body) : api.post('/org/departments', body)));
    if (r !== undefined) {
      toast(dept ? 'Department saved.' : 'Department added.');
      onDone();
    }
  };

  return (
    <Modal
      title={dept ? `Edit ${dept.name}` : 'Add a department'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="pri" busy={act.busy} disabled={!ok} onClick={save}>
            {dept ? 'Save' : 'Add department'}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Code" required hint="e.g. FIN. Used in imports." error={codeErr}>
          <Input value={code} maxLength={10} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        </Field>
        <Field label="Name" required>
          <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Branch" hint="Leave on All branches if it spans branches.">
          <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} placeholder="All branches" options={branches.map((b) => ({ value: b.id, label: b.active ? b.name : `${b.name} (inactive)` }))} />
        </Field>
        <Field label="Head of department">
          <EmployeePicker value={headId} onChange={(v) => setHeadId(v)} />
        </Field>
        <div className="field wide">
          <Toggle checked={active} onChange={setActive} label="Active" />
        </div>
        <div className="wide">
          <ErrorBox error={act.error} />
        </div>
      </div>
    </Modal>
  );
}
