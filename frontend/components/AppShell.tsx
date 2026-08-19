'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getFindingStats, getHealth, getTicketStats } from '../lib/api';
import { ROLE_LABEL } from '../lib/auth';
import { useAuth } from './AuthProvider';
import {
  IconAlert,
  IconBug,
  IconDashboard,
  IconHistory,
  IconPlus,
  IconSettings,
} from './Icons';

/**
 * The application frame: sidebar navigation, top bar, health indicator.
 *
 * Auth pages render without it (they have their own centred layout), and it
 * renders nothing until the session is known, so the sidebar never flashes for
 * a signed-out visitor.
 */

/**
 * Navigation, in plain English.
 *
 * "Triage inbox" was jargon — nobody outside QA knows what triage means, and it
 * did not say what the screen contains. Every label here names the THING you
 * find on the page, and the section headers say when you use it.
 */
const NAV = [
  {
    href: '/',
    label: 'Overview',
    hint: 'Your numbers at a glance',
    Icon: IconDashboard,
    exact: true,
    group: 'Testing',
  },
  {
    href: '/runs/new',
    label: 'Test a page',
    hint: 'Paste a URL and start',
    Icon: IconPlus,
    exact: true,
    group: 'Testing',
  },
  {
    href: '/runs',
    label: 'Past tests',
    hint: 'Everything you have run',
    Icon: IconHistory,
    group: 'Testing',
  },
  {
    href: '/findings',
    label: 'Failures',
    hint: 'Decide: real bug or not',
    Icon: IconAlert,
    counter: 'findings' as const,
    group: 'Bugs',
  },
  {
    href: '/tickets',
    label: 'Bug tickets',
    hint: 'Assigned to developers',
    Icon: IconBug,
    counter: 'tickets' as const,
    group: 'Bugs',
  },
  {
    href: '/account',
    label: 'Settings',
    hint: 'Your account and team',
    Icon: IconSettings,
    group: 'You',
  },
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

  // Longest href first, so /runs/new wins over /runs.
  const current = [...NAV]
    .sort((a, b) => b.href.length - a.href.length)
    .find((n) => (n.exact ? pathname === n.href : pathname.startsWith(n.href)));

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-mark">AI</span>
          <span>Testing Platform</span>
        </Link>

        {NAV.map((item, i) => {
          const active = current?.href === item.href;
          const count = item.counter ? counts[item.counter] : 0;
          const newGroup = i === 0 || NAV[i - 1].group !== item.group;
          return (
            <div key={item.href}>
              {newGroup && <div className="nav-label">{item.group}</div>}
              <Link
                href={item.href}
                className={`nav-item ${active ? 'nav-item-active' : ''}`}
                title={item.hint}
              >
                <span className="nav-icon">
                  <item.Icon size={17} />
                </span>
                <span>{item.label}</span>
                {count > 0 && <span className="nav-count">{count}</span>}
              </Link>
            </div>
          );
        })}

        <div className="sidebar-footer">
          <UserMenu />
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <span className="topbar-title">{current?.label ?? 'Test run'}</span>
          {current?.hint && <span className="faint">{current.hint}</span>}
          <div className="spacer" />
          {/* Signed-in identity is shown here as well as the sidebar: seeing data
              that belongs to a different account is confusing, so the account is
              always on screen. */}
          <span className="pill">
            {user.email} · {ROLE_LABEL[user.role]}
          </span>
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
