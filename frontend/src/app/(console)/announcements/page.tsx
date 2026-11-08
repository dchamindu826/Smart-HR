'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useApi } from '@/lib/hooks';
import { ago, colomboIso, date, dateTime, today } from '@/lib/format';
import { Async, Button, Card, Check, Chip, Empty, ErrorBox, Field, Input, Modal, PageHeader, Seg, Textarea, Toggle, useUi } from '@/components/ui';

type Audience = 'ALL' | 'BRANCHES' | 'DEPARTMENTS';
interface Item {
  id: string;
  title: string;
  body: string;
  audience: Audience;
  branchIds: string[];
  departmentIds: string[];
  pinned: boolean;
  requireAck: boolean;
  publishedAt: string;
  expiresAt: string | null;
  author: string;
  read: boolean;
  acknowledged: boolean;
  readCount?: number;
}
interface Named {
  id: string;
  name: string;
}
interface Readers {
  audience: number;
  read: { user: Named; readAt: string; acknowledged: boolean }[];
  notRead: Named[];
}

export default function AnnouncementsPage() {
  const { me, can, has } = useAuth();
  const { toast, confirm } = useUi();
  const act = useAction();
  const enabled = has('announcements');
  const poster = can('announce.post') && !me?.support;
  const { data, error, loading, reload, setData } = useApi<Item[]>(enabled ? '/announcements' : null);
  const branches = useApi<Named[]>(poster ? '/org/branches' : null);
  const depts = useApi<Named[]>(poster ? '/org/departments' : null);
  const [posting, setPosting] = useState(false);
  const [readersOf, setReadersOf] = useState<Item | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  // Mark each unread item read once when it is shown; keep a "New" badge for this visit.
  useEffect(() => {
    if (!data || me?.support) return;
    const unread = data.filter((a) => !a.read && !seen.current.has(a.id));
    if (!unread.length) return;
    unread.forEach((a) => seen.current.add(a.id));
    setFresh((s) => new Set([...s, ...unread.map((a) => a.id)]));
    unread.forEach((a) => api.post(`/announcements/${a.id}/read`, { acknowledge: false }).catch(() => undefined));
  }, [data, me?.support]);

  const nameList = (ids: string[], list: Named[] | null) => ids.map((id) => list?.find((x) => x.id === id)?.name).filter(Boolean).join(', ');
  const audienceChip = (a: Item) => {
    if (a.audience === 'ALL') return <Chip>Everyone</Chip>;
    if (a.audience === 'BRANCHES') {
      const n = poster ? nameList(a.branchIds, branches.data) : '';
      return <Chip tone="info" title={n || undefined}>{n ? `Branches: ${n}` : 'Your branch'}</Chip>;
    }
    const n = poster ? nameList(a.departmentIds, depts.data) : '';
    return <Chip tone="info" title={n || undefined}>{n ? `Departments: ${n}` : 'Your department'}</Chip>;
  };

  const acknowledge = async (a: Item) => {
    const r = await act.run(() => api.post(`/announcements/${a.id}/read`, { acknowledge: true }));
    if (r !== undefined) {
      toast('Thank you — acknowledged.');
      setData((d) => (d ? d.map((x) => (x.id === a.id ? { ...x, read: true, acknowledged: true } : x)) : d));
    }
  };

  const remove = async (a: Item) => {
    if ((await confirm({ title: `Delete "${a.title}"?`, body: 'It disappears for everyone, with its read receipts.', ok: 'Delete', danger: true })) === false) return;
    const r = await act.run(() => api.del(`/announcements/${a.id}`));
    if (r !== undefined) {
      toast('Announcement deleted.');
      reload();
    }
  };

  if (!enabled) {
    return (
      <>
        <PageHeader title="Inter communications" />
        <Card>
          <Empty title="Announcements are not in your plan" icon="megaphone">
            Ask Lumi AI to add announcements to your SmartHR plan.
          </Empty>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Inter communications"
        sub="Company announcements. Pinned ones stay at the top."
        actions={
          poster && (
            <Button variant="pri" icon="megaphone" onClick={() => setPosting(true)}>
              New announcement
            </Button>
          )
        }
      />
      <ErrorBox error={act.error} />
      <Async data={data} error={error} loading={loading}>
        {(rows) =>
          rows.length === 0 ? (
            <Card>
              <Empty title="No announcements" icon="megaphone">
                {poster ? 'Post news, notices and policy changes for everyone or for a branch.' : 'Company news and notices will show here.'}
              </Empty>
            </Card>
          ) : (
            <div className="stack">
              {rows.map((a) => (
                <section className="card" key={a.id} style={{ marginTop: 0, borderLeft: a.pinned ? '3px solid var(--magenta)' : undefined }}>
                  <div className="card-h">
                    <h2>{a.title}</h2>
                    {a.pinned && (
                      <Chip tone="mag">
                        Pinned
                      </Chip>
                    )}
                    {fresh.has(a.id) && <Chip tone="info">New</Chip>}
                    <div className="sp">
                      {audienceChip(a)}
                      {poster && (
                        <>
                          <Button size="xs" icon="eye" onClick={() => setReadersOf(a)}>
                            {a.readCount ?? 0} read
                          </Button>
                          <Button size="xs" variant="ghost" icon="trash" aria-label="Delete" title="Delete" onClick={() => remove(a)} />
                        </>
                      )}
                    </div>
                  </div>
                  <div className="card-b">
                    <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.55 }}>{a.body}</div>
                  </div>
                  <div className="card-f" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="small muted" title={dateTime(a.publishedAt)}>
                      {a.author} · {date(a.publishedAt)} ({ago(a.publishedAt)})
                      {a.expiresAt && <> · until {date(a.expiresAt)}</>}
                    </span>
                    {a.requireAck &&
                      (a.acknowledged ? (
                        <Chip tone="ok">Acknowledged</Chip>
                      ) : (
                        <span className="row tight">
                          <Chip tone="warn">Requires acknowledgement</Chip>
                          {!me?.support && (
                            <Button size="sm" variant="pri" icon="check" busy={act.busy} onClick={() => acknowledge(a)}>
                              Acknowledge
                            </Button>
                          )}
                        </span>
                      ))}
                  </div>
                </section>
              ))}
            </div>
          )
        }
      </Async>

      {posting && (
        <PostModal
          branches={branches.data ?? []}
          depts={depts.data ?? []}
          branchScope={me?.user.role === 'HR_OFFICER' ? me.user.branchScope : []}
          onClose={() => setPosting(false)}
          onDone={() => {
            setPosting(false);
            toast('Announcement posted.');
            reload();
          }}
        />
      )}
      {readersOf && <ReadersModal item={readersOf} onClose={() => setReadersOf(null)} />}
    </>
  );
}

function PostModal({ branches, depts, branchScope, onClose, onDone }: { branches: Named[]; depts: Named[]; branchScope: string[]; onClose: () => void; onDone: () => void }) {
  const act = useAction();
  const scoped = branchScope.length > 0;
  const [f, setF] = useState({ title: '', body: '', audience: (scoped ? 'BRANCHES' : 'ALL') as Audience, pinned: false, requireAck: false, expires: '', push: true });
  const [picked, setPicked] = useState<Set<string>>(new Set(scoped && branchScope.length === 1 ? branchScope : []));
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const options = f.audience === 'BRANCHES' ? (scoped ? branches.filter((b) => branchScope.includes(b.id)) : branches) : depts;

  const toggle = (id: string, on: boolean) =>
    setPicked((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const changeAudience = (a: Audience) => {
    set('audience', a);
    setPicked(new Set());
  };

  const ids = [...picked];
  const ok = f.title.trim().length >= 3 && f.body.trim().length >= 3 && (f.audience === 'ALL' || ids.length > 0) && (!f.expires || f.expires >= today());

  const submit = async () => {
    const r = await act.run(() =>
      api.post('/announcements', {
        title: f.title.trim(),
        body: f.body.trim(),
        audience: f.audience,
        branchIds: f.audience === 'BRANCHES' ? ids : [],
        departmentIds: f.audience === 'DEPARTMENTS' ? ids : [],
        pinned: f.pinned,
        requireAck: f.requireAck,
        expiresAt: f.expires ? colomboIso(f.expires, '23:59') : null,
        push: f.push,
      }),
    );
    if (r !== undefined) onDone();
  };

  return (
    <Modal
      title="New announcement"
      size="wide"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="pri" icon="send" busy={act.busy} disabled={!ok} onClick={submit}>
            Post
          </Button>
        </>
      }
    >
      <div className="stack">
        <ErrorBox error={act.error} />
        <Field label="Title" required>
          <Input autoFocus maxLength={120} value={f.title} onChange={(e) => set('title', e.target.value)} />
        </Field>
        <Field label="Message" required hint={`${f.body.length} / 5000`}>
          <Textarea maxLength={5000} value={f.body} onChange={(e) => set('body', e.target.value)} style={{ minHeight: 160 }} />
        </Field>
        <Field label="Who sees it">
          <Seg
            value={f.audience}
            onChange={changeAudience}
            options={
              scoped
                ? [{ value: 'BRANCHES', label: 'My branches' }]
                : [
                    { value: 'ALL', label: 'Everyone' },
                    { value: 'BRANCHES', label: 'Branches' },
                    { value: 'DEPARTMENTS', label: 'Departments' },
                  ]
            }
          />
        </Field>
        {f.audience !== 'ALL' && (
          <div className="grid3" style={{ gap: 8 }}>
            {options.length === 0 && <span className="muted small">No {f.audience === 'BRANCHES' ? 'branches' : 'departments'} to choose from.</span>}
            {options.map((o) => (
              <Check key={o.id} checked={picked.has(o.id)} onChange={(v) => toggle(o.id, v)} label={o.name} />
            ))}
          </div>
        )}
        <div className="form-grid">
          <Field label="Show until" hint="Blank = no end date. It disappears after this day.">
            <Input type="date" min={today()} value={f.expires} onChange={(e) => set('expires', e.target.value)} />
          </Field>
          <div className="field" style={{ gap: 10, justifyContent: 'flex-end' }}>
            <Toggle checked={f.pinned} onChange={(v) => set('pinned', v)} label="Pin to the top" />
            <Toggle checked={f.requireAck} onChange={(v) => set('requireAck', v)} label="Require acknowledgement" />
            <Toggle checked={f.push} onChange={(v) => set('push', v)} label="Send a push notification to phones" />
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ReadersModal({ item, onClose }: { item: Item; onClose: () => void }) {
  const { data, error, loading } = useApi<Readers>(`/announcements/${item.id}/readers`);
  return (
    <Modal title={`Read receipts — ${item.title}`} size="wide" onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      <Async data={data} error={error} loading={loading}>
        {(d) => (
          <div className="stack">
            <div className="row">
              <Chip tone="ok">{d.read.length} read</Chip>
              <Chip tone="warn">{d.notRead.length} not read</Chip>
              {item.requireAck && <Chip tone="info">{d.read.filter((r) => r.acknowledged).length} acknowledged</Chip>}
              <span className="small muted">Audience: {d.audience} people</span>
            </div>
            <div className="grid2">
              <div>
                <h3 style={{ fontSize: 14, marginBottom: 6 }}>Read</h3>
                {d.read.length === 0 ? (
                  <p className="small muted">Nobody yet.</p>
                ) : (
                  <div className="card" style={{ maxHeight: 360, overflowY: 'auto' }}>
                    {d.read.map((r) => (
                      <div className="list-row" key={r.user.id}>
                        <div className="bd">
                          <b>{r.user.name}</b>
                          <span>{dateTime(r.readAt)}</span>
                        </div>
                        {item.requireAck && (r.acknowledged ? <Chip tone="ok">Acknowledged</Chip> : <Chip tone="warn">Not acknowledged</Chip>)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <h3 style={{ fontSize: 14, marginBottom: 6 }}>Not read</h3>
                {d.notRead.length === 0 ? (
                  <p className="small muted">Everyone has read it.</p>
                ) : (
                  <div className="card" style={{ maxHeight: 360, overflowY: 'auto' }}>
                    {d.notRead.map((u) => (
                      <div className="list-row" key={u.id}>
                        <div className="bd">
                          <b>{u.name}</b>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </Async>
    </Modal>
  );
}
