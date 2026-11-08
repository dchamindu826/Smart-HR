'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useApi, useDebounced, usePoll } from '@/lib/hooks';
import { ago, date, label, time } from '@/lib/format';
import { Avatar, Button, Card, Chip, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, useUi } from '@/components/ui';

interface Conv {
  id: string;
  kind: 'DIRECT' | 'GROUP';
  title: string | null;
  members: { id: string; name: string }[];
  last: { body: string; sender: string; at: string } | null;
  unread: number;
  lastMessageAt: string;
}
interface Msg {
  id: string;
  body: string | null;
  deleted: boolean;
  sender: { id: string; name: string };
  mine: boolean;
  createdAt: string;
}
interface Thread {
  conversation: { id: string; kind: 'DIRECT' | 'GROUP'; title: string | null };
  messages: Msg[];
}
interface PersonRow {
  id: string;
  name: string;
  role: string;
  employee: { designation: string | null; department: { name: string } | null } | null;
}

const PAGE = 100;

export default function MessagesPage() {
  const { me, has } = useAuth();
  const router = useRouter();
  const sp = useSearchParams();
  const selected = sp.get('c');
  const enabled = has('messaging');
  const convs = useApi<Conv[]>(enabled ? '/messages' : null);
  const [starting, setStarting] = useState(false);
  usePoll(() => enabled && convs.reload(), 15_000);

  const open = useCallback((id: string) => router.replace(`/messages?c=${id}`), [router]);

  if (!enabled) {
    return (
      <>
        <PageHeader title="Messages" />
        <Card>
          <Empty title="Messaging is not in your plan" icon="chat">
            Ask Lumi AI to add internal messaging to your SmartHR plan.
          </Empty>
        </Card>
      </>
    );
  }

  const current = convs.data?.find((c) => c.id === selected) ?? null;

  return (
    <>
      <PageHeader
        title="Messages"
        sub="Direct and group messages inside the company."
        actions={
          !me?.support && (
            <Button variant="pri" icon="chat" onClick={() => setStarting(true)}>
              New message
            </Button>
          )
        }
      />
      <Card pad={false}>
        <div className="chat">
          <div className="convs">
            {convs.error && !convs.data && <div className="card-b"><ErrorBox error={convs.error} /></div>}
            {!convs.data && convs.loading && <Loading />}
            {convs.data && convs.data.length === 0 && (
              <Empty title="No conversations yet" icon="chat">
                Start one with New message.
              </Empty>
            )}
            {convs.data?.map((c) => (
              <button key={c.id} className={`conv ${c.id === selected ? 'on' : ''}`} onClick={() => open(c.id)}>
                <div className="row" style={{ flexWrap: 'nowrap', gap: 9 }}>
                  <Avatar name={c.title ?? '?'} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row between" style={{ flexWrap: 'nowrap' }}>
                      <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: c.unread ? 700 : 600 }}>{c.title ?? 'Conversation'}</b>
                      <span className="tiny faint nowrap">{c.last ? ago(c.last.at) : ''}</span>
                    </div>
                    <div className="row between" style={{ flexWrap: 'nowrap' }}>
                      <span className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.last ? `${c.kind === 'GROUP' ? `${c.last.sender.split(' ')[0]}: ` : ''}${c.last.body}` : c.kind === 'GROUP' ? `${c.members.length} members` : 'No messages yet'}
                      </span>
                      {c.unread > 0 && (
                        <span className="chip bad" style={{ flex: 'none' }}>
                          {c.unread}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
          {selected ? (
            <ThreadView key={selected} id={selected} conv={current} readOnly={!!me?.support} onActivity={convs.reload} />
          ) : (
            <div className="thread" style={{ justifyContent: 'center' }}>
              <Empty title="Choose a conversation" icon="chat">
                Or start a new one.
              </Empty>
            </div>
          )}
        </div>
      </Card>
      {starting && (
        <NewMessageModal
          onClose={() => setStarting(false)}
          onDone={(id) => {
            setStarting(false);
            convs.reload();
            open(id);
          }}
        />
      )}
    </>
  );
}

function ThreadView({ id, conv, readOnly, onActivity }: { id: string; conv: Conv | null; readOnly: boolean; onActivity: () => void }) {
  const { toast, confirm } = useUi();
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [meta, setMeta] = useState<Thread['conversation'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [text, setText] = useState('');
  const send = useAction();
  const box = useRef<HTMLDivElement>(null);
  const scroll = useRef<{ mode: 'bottom' | 'keep' | 'stick'; prevHeight: number }>({ mode: 'bottom', prevHeight: 0 });
  const polling = useRef(false);
  const msgsRef = useRef<Msg[] | null>(null);
  msgsRef.current = msgs;

  useEffect(() => {
    let alive = true;
    api
      .get<Thread>(`/messages/${id}`)
      .then((r) => {
        if (!alive) return;
        scroll.current.mode = 'bottom';
        setMeta(r.conversation);
        setMsgs(r.messages);
        setHasMore(r.messages.length >= PAGE);
        onActivity(); // unread count changed
      })
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const poll = useCallback(async () => {
    const list = msgsRef.current;
    if (!list || polling.current) return;
    polling.current = true;
    try {
      const last = list[list.length - 1];
      const r = await api.get<Thread>(`/messages/${id}`, last ? { since: last.createdAt } : undefined);
      if (r.messages.length) {
        const el = box.current;
        const nearBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        scroll.current.mode = nearBottom ? 'bottom' : 'stick';
        setMsgs((cur) => {
          const base = cur ?? [];
          const ids = new Set(base.map((m) => m.id));
          const add = r.messages.filter((m) => !ids.has(m.id));
          return add.length ? [...base, ...add] : base;
        });
        onActivity();
      }
    } catch {
      /* try again on the next tick */
    } finally {
      polling.current = false;
    }
  }, [id, onActivity]);
  usePoll(poll, 5000);

  const older = async () => {
    const first = msgs?.[0];
    if (!first) return;
    setLoadingOlder(true);
    try {
      const r = await api.get<Thread>(`/messages/${id}`, { before: first.createdAt });
      scroll.current = { mode: 'keep', prevHeight: box.current?.scrollHeight ?? 0 };
      setMsgs((cur) => {
        const ids = new Set((cur ?? []).map((m) => m.id));
        return [...r.messages.filter((m) => !ids.has(m.id)), ...(cur ?? [])];
      });
      setHasMore(r.messages.length >= PAGE);
    } catch (e) {
      toast(errorMessage(e), 'bad');
    } finally {
      setLoadingOlder(false);
    }
  };

  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !msgs) return;
    if (scroll.current.mode === 'bottom') el.scrollTop = el.scrollHeight;
    else if (scroll.current.mode === 'keep') el.scrollTop = el.scrollHeight - scroll.current.prevHeight;
    scroll.current.mode = 'stick';
  }, [msgs]);

  const submit = async () => {
    const body = text.trim();
    if (!body || send.busy) return;
    const r = await send.run(() => api.post<{ id: string; createdAt: string }>(`/messages/${id}`, { body }));
    if (r !== undefined) {
      setText('');
      scroll.current.mode = 'bottom';
      await poll();
      onActivity();
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const composing = (e as unknown as { nativeEvent?: { isComposing?: boolean } }).nativeEvent?.isComposing;
    if (e.key === 'Enter' && !e.shiftKey && !composing) {
      e.preventDefault();
      submit();
    }
  };

  const del = async (m: Msg) => {
    if ((await confirm({ title: 'Delete this message?', body: 'Everyone in the conversation sees "Message removed".', ok: 'Delete', danger: true })) === false) return;
    try {
      await api.del(`/messages/message/${m.id}`);
      setMsgs((cur) => (cur ? cur.map((x) => (x.id === m.id ? { ...x, body: null, deleted: true } : x)) : cur));
      onActivity();
    } catch (e) {
      toast(errorMessage(e), 'bad');
    }
  };

  const title = conv?.title ?? meta?.title ?? 'Conversation';
  const isGroup = (conv?.kind ?? meta?.kind) === 'GROUP';

  return (
    <div className="thread">
      <div className="card-h">
        <h2>{title}</h2>
        {isGroup && conv && (
          <span className="sub" title={conv.members.map((m) => m.name).join(', ')}>
            {conv.members.length} members: {conv.members.map((m) => m.name.split(' ')[0]).join(', ')}
          </span>
        )}
      </div>
      <div className="msgs" ref={box}>
        {error && <ErrorBox error={error} />}
        {!msgs && !error && <Loading />}
        {hasMore && (
          <div className="center">
            <Button size="xs" busy={loadingOlder} onClick={older}>
              Load older messages
            </Button>
          </div>
        )}
        {msgs && msgs.length === 0 && <div className="center muted small" style={{ marginTop: 30 }}>No messages yet. Say hello.</div>}
        {msgs?.map((m, i) => {
          const prev = msgs[i - 1];
          const showDay = !prev || date(prev.createdAt) !== date(m.createdAt);
          const showName = isGroup && !m.mine && (!prev || prev.sender.id !== m.sender.id || showDay);
          return (
            <div key={m.id} style={{ display: 'contents' }}>
              {showDay && (
                <div className="center tiny faint" style={{ margin: '6px 0' }}>
                  {date(m.createdAt) === date(new Date()) ? 'Today' : date(m.createdAt, { weekday: true })}
                </div>
              )}
              <div className={`msg ${m.mine ? 'mine' : ''}`} style={m.deleted ? { fontStyle: 'italic', opacity: 0.6 } : undefined}>
                {showName && <b style={{ display: 'block', fontSize: 12, marginBottom: 2 }}>{m.sender.name}</b>}
                {m.deleted ? 'Message removed' : m.body}
                <small>
                  {time(m.createdAt)}
                  {m.mine && !m.deleted && !readOnly && (
                    <>
                      {' · '}
                      <button onClick={() => del(m)} style={{ color: 'inherit', textDecoration: 'underline', fontSize: 'inherit' }}>
                        delete
                      </button>
                    </>
                  )}
                </small>
              </div>
            </div>
          );
        })}
      </div>
      {readOnly ? (
        <div className="compose small muted">Support view is read-only.</div>
      ) : (
        <div className="compose" style={{ flexDirection: 'column' }}>
          {send.error && <ErrorBox error={send.error} />}
          <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-end' }}>
            <textarea
              className="textarea"
              rows={2}
              maxLength={4000}
              placeholder="Write a message… (Enter sends, Shift+Enter for a new line)"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              style={{ minHeight: 44, maxHeight: 160, flex: 1 }}
            />
            <Button variant="pri" icon="send" busy={send.busy} disabled={!text.trim()} onClick={submit}>
              Send
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function NewMessageModal({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const act = useAction();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const people = useApi<PersonRow[]>('/messages/people', { q: dq });
  const [picked, setPicked] = useState<Map<string, string>>(new Map());
  const [title, setTitle] = useState('');
  const group = picked.size > 1;

  const toggle = (p: PersonRow) =>
    setPicked((m) => {
      const n = new Map(m);
      if (n.has(p.id)) n.delete(p.id);
      else n.set(p.id, p.name);
      return n;
    });

  const start = async () => {
    const r = await act.run(() => api.post<{ id: string }>('/messages', { userIds: [...picked.keys()], title: group ? title.trim() : null }));
    if (r !== undefined) onDone(r.id);
  };

  return (
    <Modal
      title="New message"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="pri" busy={act.busy} disabled={picked.size === 0 || (group && title.trim().length < 2)} onClick={start}>
            {group ? 'Create group' : 'Open chat'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <ErrorBox error={act.error} />
        {picked.size > 0 && (
          <div className="row tight">
            {[...picked.entries()].map(([id, name]) => (
              <button key={id} className="chip info" onClick={() => setPicked((m) => { const n = new Map(m); n.delete(id); return n; })} title="Remove">
                {name} ×
              </button>
            ))}
          </div>
        )}
        {group && (
          <Field label="Group name" required hint="Needed when you message more than one person.">
            <Input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Kandy branch supervisors" />
          </Field>
        )}
        <Input autoFocus placeholder="Search people by name…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="card" style={{ maxHeight: 300, overflowY: 'auto' }}>
          {people.error && <div className="card-b"><ErrorBox error={people.error} /></div>}
          {!people.data && people.loading && <Loading />}
          {people.data?.length === 0 && <div className="card-b muted small">No one found.</div>}
          {people.data?.map((p) => {
            const on = picked.has(p.id);
            return (
              <button key={p.id} className="list-row" style={{ width: '100%', textAlign: 'left', background: on ? 'var(--info-bg)' : undefined }} onClick={() => toggle(p)}>
                <input type="checkbox" readOnly checked={on} tabIndex={-1} style={{ accentColor: 'var(--blue)' }} />
                <Avatar name={p.name} />
                <div className="bd">
                  <b>{p.name}</b>
                  <span>{[p.employee?.designation, p.employee?.department?.name].filter(Boolean).join(' · ') || label(p.role)}</span>
                </div>
                {p.role !== 'EMPLOYEE' && <Chip>{label(p.role)}</Chip>}
              </button>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
