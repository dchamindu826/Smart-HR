'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useApi, useDebounced } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { Async, Avatar, Button, Card, Empty, Input, PageHeader } from '@/components/ui';
import { Icon } from '@/components/Icon';

interface ChartPerson {
  id: string;
  empNo: string;
  firstName: string;
  lastName: string;
  designation: string | null;
  managerId: string | null;
  photoPath: string | null;
  department: { name: string } | null;
  branch: { name: string } | null;
}

interface Tree {
  byId: Map<string, ChartPerson>;
  children: Map<string, ChartPerson[]>;
  roots: ChartPerson[];
  parent: Map<string, string | null>;
}

function buildTree(list: ChartPerson[]): Tree {
  const byId = new Map(list.map((p) => [p.id, p]));
  const children = new Map<string, ChartPerson[]>();
  const parent = new Map<string, string | null>();
  const roots: ChartPerson[] = [];
  for (const p of list) {
    const m = p.managerId && p.managerId !== p.id && byId.has(p.managerId) ? p.managerId : null;
    parent.set(p.id, m);
    if (m) children.set(m, [...(children.get(m) ?? []), p]);
    else roots.push(p);
  }
  // People caught in a reporting loop have no root; show them at the top so nobody is lost.
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const c of children.get(id) ?? []) walk(c.id);
  };
  roots.forEach((r) => walk(r.id));
  for (const p of list) {
    if (!seen.has(p.id)) {
      roots.push(p);
      parent.set(p.id, null);
      walk(p.id);
    }
  }
  const size = (id: string, guard = new Set<string>()): number => {
    if (guard.has(id)) return 0;
    guard.add(id);
    return (children.get(id) ?? []).reduce((n, c) => n + 1 + size(c.id, guard), 0);
  };
  // Bigger teams first, then by name.
  const sorter = (a: ChartPerson, b: ChartPerson) => size(b.id) - size(a.id) || `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
  roots.sort(sorter);
  for (const [k, v] of children) children.set(k, [...v].sort(sorter));
  return { byId, children, roots, parent };
}

const full = (p: ChartPerson) => `${p.firstName} ${p.lastName}`;

export default function OrgChartPage() {
  const { me } = useAuth();
  const { data, error, loading } = useApi<ChartPerson[]>('/org/chart');
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim().toLowerCase(), 200);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [view, setView] = useState<'diagram' | 'list'>('diagram');
  const [zoom, setZoom] = useState(1);

  const tree = useMemo(() => (data ? buildTree(data) : null), [data]);

  const matches = useMemo(() => {
    if (!tree || !dq) return new Set<string>();
    const out = new Set<string>();
    for (const p of tree.byId.values()) {
      const hay = [full(p), p.empNo, p.designation, p.department?.name, p.branch?.name].filter(Boolean).join(' ').toLowerCase();
      if (hay.includes(dq)) out.add(p.id);
    }
    return out;
  }, [tree, dq]);

  // Ancestors of matches stay open so every match is visible
  const forcedOpen = useMemo(() => {
    const s = new Set<string>();
    if (!tree) return s;
    for (const id of matches) {
      let cur = tree.parent.get(id) ?? null;
      for (let n = 0; cur && n < 100; n++) {
        s.add(cur);
        cur = tree.parent.get(cur) ?? null;
      }
    }
    return s;
  }, [tree, matches]);

  const toggle = (id: string) =>
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const collapseAll = () => {
    if (!tree) return;
    setCollapsed(new Set([...tree.children.keys()]));
  };

  const expandAll = () => {
    setCollapsed(new Set());
  };

  const zoomIn = () => setZoom((z) => Math.min(1.4, Math.round((z + 0.1) * 10) / 10));
  const zoomOut = () => setZoom((z) => Math.max(0.6, Math.round((z - 0.1) * 10) / 10));
  const resetZoom = () => setZoom(1);

  const companyName = me?.tenant.name || 'Organization';

  return (
    <>
      <PageHeader
        title="Org chart"
        sub="Hierarchical reporting tree showing who reports to whom. Active employees only."
        actions={
          <div className="seg">
            <button type="button" className={view === 'diagram' ? 'on' : ''} onClick={() => setView('diagram')}>
              Tree diagram
            </button>
            <button type="button" className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>
              Compact list
            </button>
          </div>
        }
      />
      <Async data={tree} error={error} loading={loading}>
        {(t) =>
          t.byId.size === 0 ? (
            <Card>
              <Empty title="No employees yet" icon="tree">
                Add employees and set who they report to in their employee profiles.
              </Empty>
            </Card>
          ) : (
            <Card pad={false}>
              <div className="filters">
                <Input
                  className="search"
                  type="search"
                  placeholder="Find a person, role or department…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  aria-label="Search the org chart"
                />
                {dq && (
                  <span className="small muted">
                    {matches.size} match{matches.size === 1 ? '' : 'es'}
                  </span>
                )}

                <div className="row tight" style={{ marginLeft: 'auto' }}>
                  {view === 'diagram' && (
                    <div className="row tight" style={{ marginRight: 6 }}>
                      <Button size="sm" onClick={zoomOut} title="Zoom out" disabled={zoom <= 0.6}>
                        −
                      </Button>
                      <Button size="sm" onClick={resetZoom} title="Reset zoom">
                        {Math.round(zoom * 100)}%
                      </Button>
                      <Button size="sm" onClick={zoomIn} title="Zoom in" disabled={zoom >= 1.4}>
                        +
                      </Button>
                    </div>
                  )}
                  <Button size="sm" onClick={expandAll}>
                    Expand all
                  </Button>
                  <Button size="sm" onClick={collapseAll}>
                    Collapse all
                  </Button>
                </div>
              </div>

              {view === 'diagram' ? (
                <div className="org-viewport">
                  <div className="org-tree-canvas" style={{ transform: `scale(${zoom})` }}>
                    {t.roots.length > 1 ? (
                      <>
                        <div className="org-company-node">
                          <Icon name="building" size={17} />
                          <span>{companyName}</span>
                          <span className="chip sm" style={{ marginLeft: 6 }}>
                            {t.byId.size} members
                          </span>
                        </div>
                        <ul className="org-tree org-roots-branch">
                          {t.roots.map((r) => (
                            <TreeNode
                              key={r.id}
                              person={r}
                              tree={t}
                              collapsed={collapsed}
                              forcedOpen={forcedOpen}
                              matches={matches}
                              searching={!!dq}
                              onToggle={toggle}
                              visited={new Set()}
                            />
                          ))}
                        </ul>
                      </>
                    ) : (
                      <ul className="org-tree">
                        {t.roots.map((r) => (
                          <TreeNode
                            key={r.id}
                            person={r}
                            tree={t}
                            collapsed={collapsed}
                            forcedOpen={forcedOpen}
                            matches={matches}
                            searching={!!dq}
                            onToggle={toggle}
                            visited={new Set()}
                          />
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ) : (
                <div className="card-b org-list-wrap" style={{ overflowX: 'auto' }}>
                  <ul>
                    {t.roots.map((r) => (
                      <ListNode
                        key={r.id}
                        person={r}
                        tree={t}
                        depth={0}
                        collapsed={collapsed}
                        forcedOpen={forcedOpen}
                        matches={matches}
                        searching={!!dq}
                        onToggle={toggle}
                        path={new Set()}
                      />
                    ))}
                  </ul>
                </div>
              )}

              <div className="card-f" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="small muted">
                  {t.byId.size} active employees · {t.roots.length} at top level
                </span>
                <span className="small muted">
                  Click name or avatar to open profile · Click reports button to expand/collapse
                </span>
              </div>
            </Card>
          )
        }
      </Async>
    </>
  );
}

function TreeNode({
  person,
  tree,
  collapsed,
  forcedOpen,
  matches,
  searching,
  onToggle,
  visited,
}: {
  person: ChartPerson;
  tree: Tree;
  collapsed: Set<string>;
  forcedOpen: Set<string>;
  matches: Set<string>;
  searching: boolean;
  onToggle: (id: string) => void;
  visited: Set<string>;
}) {
  if (visited.has(person.id)) return null;
  const kids = tree.children.get(person.id) ?? [];
  const open = kids.length > 0 && (forcedOpen.has(person.id) || !collapsed.has(person.id));
  const isMatch = matches.has(person.id);
  const isDimmed = searching && !isMatch;
  const nextVisited = new Set(visited);
  nextVisited.add(person.id);

  return (
    <li className="org-tree-node">
      <div className={`org-node-container ${kids.length > 0 ? 'has-kids' : ''} ${open ? 'is-open' : ''}`}>
        <div className={`org-card ${isMatch ? 'is-matched' : ''} ${isDimmed ? 'is-dimmed' : ''}`}>
          <div className="org-card-header">
            <Avatar name={full(person)} photoEmployeeId={person.photoPath ? person.id : null} />
            <div className="org-card-title">
              <Link href={`/employees/${person.id}`} className="org-card-name" title={full(person)}>
                {full(person)}
              </Link>
              <div className="org-card-role" title={person.designation || person.empNo}>
                {person.designation || person.empNo}
              </div>
            </div>
          </div>

          <div className="org-card-badge-row">
            {person.department?.name && (
              <span className="chip sm" style={{ fontSize: 11, padding: '2px 7px' }}>
                {person.department.name}
              </span>
            )}
            {person.branch?.name && (
              <span className="muted" style={{ fontSize: 11 }}>
                {person.branch.name.split('—')[0].trim()}
              </span>
            )}
          </div>

          {kids.length > 0 && (
            <button
              type="button"
              className="org-card-toggle"
              onClick={(e) => {
                e.stopPropagation();
                onToggle(person.id);
              }}
              title={open ? `Collapse ${full(person)}'s team` : `Expand ${full(person)}'s team`}
            >
              <Icon name={open ? 'chev-d' : 'chev-r'} size={13} />
              <span>
                {kids.length} {kids.length === 1 ? 'direct report' : 'direct reports'}
              </span>
            </button>
          )}
        </div>
      </div>

      {open && kids.length > 0 && (
        <ul className="org-tree-children">
          {kids.map((kid) => (
            <TreeNode
              key={kid.id}
              person={kid}
              tree={tree}
              collapsed={collapsed}
              forcedOpen={forcedOpen}
              matches={matches}
              searching={searching}
              onToggle={onToggle}
              visited={nextVisited}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function ListNode({
  person,
  tree,
  depth,
  collapsed,
  forcedOpen,
  matches,
  searching,
  onToggle,
  path,
}: {
  person: ChartPerson;
  tree: Tree;
  depth: number;
  collapsed: Set<string>;
  forcedOpen: Set<string>;
  matches: Set<string>;
  searching: boolean;
  onToggle: (id: string) => void;
  path: Set<string>;
}) {
  if (path.has(person.id)) return null;
  const kids = tree.children.get(person.id) ?? [];
  const open = kids.length > 0 && (forcedOpen.has(person.id) || !collapsed.has(person.id));
  const isMatch = matches.has(person.id);
  const isDimmed = searching && !isMatch;
  const next = new Set(path);
  next.add(person.id);

  return (
    <li>
      <div className="row tight" style={{ flexWrap: 'nowrap', alignItems: 'center' }}>
        {kids.length > 0 ? (
          <button
            type="button"
            className="tbtn"
            style={{ width: 28, height: 28 }}
            onClick={() => onToggle(person.id)}
            aria-expanded={open}
            aria-label={open ? `Hide ${full(person)}'s team` : `Show ${full(person)}'s team`}
            title={open ? 'Collapse' : 'Expand'}
          >
            <Icon name={open ? 'chev-d' : 'chev-r'} size={16} />
          </button>
        ) : (
          <span style={{ width: 28, flex: 'none' }} />
        )}
        <Link
          href={`/employees/${person.id}`}
          className="node"
          style={{
            color: 'inherit',
            textDecoration: 'none',
            opacity: isDimmed ? 0.55 : 1,
            borderColor: isMatch ? 'var(--magenta)' : undefined,
            boxShadow: isMatch ? '0 0 0 3px var(--mag-bg)' : undefined,
          }}
        >
          <Avatar name={full(person)} photoEmployeeId={person.photoPath ? person.id : null} />
          <span style={{ minWidth: 0 }}>
            <b style={{ display: 'block', lineHeight: 1.25 }}>{full(person)}</b>
            <small className="muted" style={{ display: 'block', fontSize: 12.5, marginTop: 2 }}>
              {[person.designation, person.department?.name].filter(Boolean).join(' · ') || person.empNo}
            </small>
          </span>
          {kids.length > 0 && !open && (
            <span className="chip info sm" title={`${kids.length} direct report${kids.length === 1 ? '' : 's'}`}>
              {kids.length}
            </span>
          )}
        </Link>
      </div>
      {open && kids.length > 0 && (
        <ul>
          {kids.map((c) => (
            <ListNode
              key={c.id}
              person={c}
              tree={tree}
              depth={depth + 1}
              collapsed={collapsed}
              forcedOpen={forcedOpen}
              matches={matches}
              searching={searching}
              onToggle={onToggle}
              path={next}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
