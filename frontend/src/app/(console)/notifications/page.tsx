'use client';

import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { ago, dateTime } from '@/lib/format';
import { Async, Button, Card, Empty, ErrorBox, PageHeader, useUi } from '@/components/ui';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}
interface NotificationList {
  unread: number;
  rows: Notification[];
}

/** Some links are written for the mobile app; map them to console routes. */
function consoleLink(link: string): string {
  const m = /^\/messages\/([^/?#]+)$/.exec(link);
  if (m) return `/messages?c=${encodeURIComponent(m[1])}`;
  return link;
}

export default function NotificationsPage() {
  const router = useRouter();
  const { toast } = useUi();
  const act = useAction();
  const { data, error, loading, reload, setData } = useApi<NotificationList>('/notifications');

  const markLocal = (id: string | null) =>
    setData((d) => {
      if (!d) return d;
      const now = new Date().toISOString();
      const rows = d.rows.map((n) => (id === null || n.id === id ? { ...n, readAt: n.readAt ?? now } : n));
      return { rows, unread: rows.filter((n) => !n.readAt).length };
    });

  const open = async (n: Notification) => {
    if (!n.readAt) {
      markLocal(n.id);
      api.post(`/notifications/${n.id}/read`).catch(() => undefined);
    }
    if (n.link) router.push(consoleLink(n.link));
  };

  const readAll = async () => {
    const r = await act.run(() => api.post('/notifications/read-all'));
    if (r !== undefined) {
      markLocal(null);
      toast('All notifications marked read.');
    }
  };

  return (
    <>
      <PageHeader
        title="Notifications"
        sub="The latest 50 updates about your requests, approvals, announcements and messages."
        actions={
          <>
            <Button icon="refresh" onClick={reload}>
              Refresh
            </Button>
            <Button icon="check" busy={act.busy} disabled={!data || data.unread === 0} onClick={readAll}>
              Mark all read
            </Button>
          </>
        }
      />
      <ErrorBox error={act.error} />
      <Card pad={false} title={data ? (data.unread ? `${data.unread} unread` : 'All read') : undefined}>
        <Async data={data} error={error} loading={loading}>
          {(d) =>
            d.rows.length === 0 ? (
              <Empty title="No notifications" icon="bell">
                You are all caught up.
              </Empty>
            ) : (
              <div className="notif" style={{ width: '100%', maxHeight: 'none' }}>
                {d.rows.map((n) => (
                  <button
                    key={n.id}
                    className={`n ${n.readAt ? '' : 'unread'}`}
                    onClick={() => open(n)}
                    style={{ width: '100%', textAlign: 'left', cursor: n.link || !n.readAt ? 'pointer' : 'default' }}
                  >
                    <div className="row between" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                      <div style={{ minWidth: 0 }}>
                        <b>
                          {!n.readAt && <span className="dot info" style={{ marginRight: 7, verticalAlign: 'middle' }} />}
                          {n.title}
                        </b>
                        {n.body && <span style={{ display: 'block', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{n.body}</span>}
                      </div>
                      <span className="tiny faint nowrap" title={dateTime(n.createdAt)}>
                        {ago(n.createdAt)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )
          }
        </Async>
      </Card>
    </>
  );
}
