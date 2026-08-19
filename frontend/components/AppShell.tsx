'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getFindingStats, getHealth, getTicketStats } from '../lib/api';
import { ROLE_LABEL } from '../lib/auth';
import { useAuth } from './AuthProvider';

/**
 * The application frame: sidebar navigation, top bar, health indicator.
 *
 * Auth pages render without it (they have their own centred layout), and it
 * renders nothing until the session is known, so the sidebar never flashes for
 * a signed-out visitor.
 */

const NAV = [
  { href: '/', label: 'New run', icon: '＋', exact: true },
  { href: '/runs', label: 'Test runs', icon: '▶' },
  { href: '/findings', label: 'Triage inbox', icon: '⚑', counter: 'findings' as const },
  { href: '/tickets', label: 'Tickets', icon: '☰', counter: 'tickets' as const },
  { href: '/account', label: 'Account', icon: '○' },
];

const AUTH_PATHS = ['/login', '/register'];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, loading } = useAuth();

  const [counts, setCounts] = useState({ findings: 0, tickets: 0 });

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const load = async () => {
      try {
        const [f, t] = await Promise.all([getFindingStats(), getTicketStats()]);
        if (cancelled) return;
        setCounts({
          // Only the queues that need a human today.
          findings: (f.NEW ?? 0) + (f.REOPENED ?? 0),
          tickets: (t.OPEN ?? 0) + (t.READY_FOR_RETEST ?? 0) + (t.REOPENED ?? 0),
        });
      } catch {
        /* badges are decoration - never block the shell on them */
      }
    };

    void load();
    const timer = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [user, pathname]);

  if (AUTH_PATHS.includes(pathname)) return <>{children}</>;

  if (loading || !user) {
    return (
      <div className="auth-wrap">
        <div className="row" style={{ color: 'var(--text-dim)' }}>
          <span className="spinner" /> Loading
        </div>
      </div>
    );
  }

  const current = NAV.find((n) =>
    n.exact ? pathname === n.href : pathname.startsWith(n.href) && n.href !== '/',
  );

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-mark">AI</span>
          <span>Testing Platform</span>
        </Link>

        <div className="nav-label">Workspace</div>
        {NAV.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          const count = item.counter ? counts[item.counter] : 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item ${active ? 'nav-item-active' : ''}`}
            >
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
              {count > 0 && <span className="nav-count">{count}</span>}
            </Link>
          );
        })}

        <div className="sidebar-footer">
          <UserMenu />
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <span className="topbar-title">{current?.label ?? 'Test run'}</span>
          <div className="spacer" />
          <HealthDot />
        </div>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}

function UserMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  if (!user) return null;

  const initials = user.name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div>
      <button className="user-chip" onClick={() => setOpen((v) => !v)}>
        <span className="avatar">{initials}</span>
        <span style={{ minWidth: 0 }}>
          <span className="user-name">{user.name}</span>
          <br />
          <span className="user-role">{ROLE_LABEL[user.role]}</span>
        </span>
      </button>
      {open && (
        <div className="stack-sm" style={{ marginTop: 6 }}>
          <Link href="/account" className="btn btn-sm btn-block btn-ghost">
            Account &amp; sessions
          </Link>
          <button className="btn btn-sm btn-block" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function HealthDot() {
  const [state, setState] = useState<{ ok: boolean; label: string; detail: string }>({
    ok: false,
    label: 'checking',
    detail: '',
  });

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const h = await getHealth();
        if (cancelled) return;
        const problems: string[] = [];
        if (!h.database.ok) problems.push('database down');
        if (!h.llm.keyLoaded) problems.push('LLM key missing');
        setState({
          ok: problems.length === 0,
          label: problems.length ? problems.join(', ') : 'connected',
          detail: `${h.llm.provider} · ${h.llm.model}`,
        });
      } catch (err) {
        if (!cancelled) setState({ ok: false, label: 'backend offline', detail: String(err) });
      }
    };

    void check();
    const timer = setInterval(check, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <span
      className={`badge ${state.ok ? 'badge-pass' : 'badge-fail'}`}
      title={state.detail || state.label}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: 'currentColor',
          display: 'inline-block',
        }}
      />
      {state.label}
    </span>
  );
}
