'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  ClassificationBadge,
  PriorityBadge,
  RunStatusBadge,
  TicketStatusBadge,
} from '../components/StatusBadge';
import { getDashboard } from '../lib/api';
import { SEVERITY_LABEL, type DashboardOverview } from '../lib/types';

/**
 * THE DASHBOARD.
 *
 * Ordered by what a QA lead needs, top to bottom:
 *   1. Is the suite healthy?      -> pass rate + result breakdown
 *   2. What needs me today?       -> triage queue and tickets to retest
 *   3. Is the tooling trustworthy? -> product bugs vs test defects
 *   4. What happened recently?    -> run history
 */
export default function DashboardPage() {
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = () =>
      getDashboard()
        .then((d) => !cancelled && (setData(d), setError(null)))
        .catch((e) => !cancelled && setError((e as Error).message));

    void load();
    const timer = setInterval(load, 8000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (error) return <div className="banner banner-error">{error}</div>;

  if (!data) {
    return (
      <div className="empty">
        <span className="spinner" /> Loading dashboard
      </div>
    );
  }

  const { tests, findings, tickets, runs } = data;
  const isEmpty = runs.total === 0;

  return (
    <div className="stack">
      {/* ------------------------------------------------------------ header */}
      <div className="spread page-hero">
        <div>
          <span className="eyebrow">Quality overview</span>
          <h1>Your testing command center</h1>
          <span className="page-subtitle">
            {runs.total} run{runs.total === 1 ? '' : 's'} · {tests.total} test cases ·{' '}
            {findings.confirmed} confirmed bug{findings.confirmed === 1 ? '' : 's'}
          </span>
        </div>
        <Link href="/runs/new" className="btn btn-primary btn-lg">
          <span aria-hidden="true">+</span> New test run
        </Link>
      </div>

      {isEmpty ? (
        <EmptyState />
      ) : (
        <>
          {/* ------------------------------------------------ suite health */}
          <div className="grid-sidebar">
            <div className="card suite-health-card">
              <div className="card-head">
                <h2>Suite health</h2>
                <span className="faint">Latest result per test case</span>
              </div>

              <div className="row" style={{ alignItems: 'flex-end', gap: 20, marginBottom: 14 }}>
                <div>
                  <div
                    style={{
                      fontSize: 44,
                      fontWeight: 700,
                      lineHeight: 1,
                      letterSpacing: '-0.03em',
                      color:
                        tests.passRate === null
                          ? 'var(--text-faint)'
                          : tests.passRate >= 80
                            ? 'var(--pass)'
                            : tests.passRate >= 50
                              ? 'var(--warn)'
                              : 'var(--fail)',
                    }}
                  >
                    {tests.passRate === null ? '—' : `${tests.passRate}%`}
                  </div>
                  <div className="stat-label">Pass rate</div>
                </div>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <ResultBar tests={tests} />
                </div>
              </div>

              <div className="stats">
                <Stat label="Passed" value={tests.passed} tone="pass" />
                <Stat label="Failed" value={tests.failed} tone="fail" />
                <Stat label="Errored" value={tests.errored} tone="fail" />
                <Stat label="Flaky" value={tests.flaky} tone="warn" />
                <Stat label="Not run" value={tests.total - tests.executed} />
              </div>
            </div>

            {/* ------------------------------------------- needs attention */}
            <div className="card">
              <div className="card-head">
                <h2>Needs you today</h2>
              </div>
              <div className="stack-sm">
                <AttentionRow
                  href="/findings"
                  count={findings.awaitingTriage}
                  label="failures to review"
                  tone="warn"
                />
                <AttentionRow
                  href="/tickets"
                  count={tickets.readyForRetest}
                  label="tickets ready to retest"
                  tone="brand"
                />
                <AttentionRow
                  href="/tickets"
                  count={tickets.open}
                  label="open tickets"
                  tone="info"
                />
                <AttentionRow
                  href="/findings"
                  count={findings.confirmed}
                  label="confirmed bugs"
                  tone="fail"
                />
              </div>
            </div>
          </div>

          {/* ----------------------------------------- queues + trust panel */}
          <div className="grid-sidebar">
            <div className="stack">
              {data.needsTriage.length > 0 && (
                <div className="card">
                  <div className="card-head">
                    <h2>Failures to review</h2>
                    <Link href="/findings" className="btn btn-sm btn-ghost">
                      Open inbox
                    </Link>
                  </div>
                  <div className="stack-sm">
                    {data.needsTriage.map((f) => (
                      <Link
                        key={f.id}
                        href="/findings"
                        className="card card-tight card-link"
                        style={{ boxShadow: 'none' }}
                      >
                        <div className="row">
                          {f.bugKey && <span className="pill pill-key">{f.bugKey}</span>}
                          <PriorityBadge priority={f.testCase.priority} />
                          <span className="truncate" style={{ fontWeight: 570, maxWidth: 340 }}>
                            {f.testCase.title}
                          </span>
                        </div>
                        <div className="row faint" style={{ marginTop: 5 }}>
                          <ClassificationBadge
                            value={f.aiClassification}
                            confidence={f.aiConfidence}
                            ai
                          />
                          <span>seen {f.occurrences}×</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {data.needsRetest.length > 0 && (
                <div className="card">
                  <div className="card-head">
                    <h2>Bug tickets in progress</h2>
                    <Link href="/tickets" className="btn btn-sm btn-ghost">
                      Open board
                    </Link>
                  </div>
                  <div className="stack-sm">
                    {data.needsRetest.map((t) => (
                      <Link
                        key={t.id}
                        href={`/tickets/${t.id}`}
                        className="card card-tight card-link"
                        style={{ boxShadow: 'none' }}
                      >
                        <div className="row">
                          <span className="pill pill-key">{t.key}</span>
                          <TicketStatusBadge status={t.status} />
                          <PriorityBadge priority={t.priority} />
                        </div>
                        <div className="truncate" style={{ marginTop: 5, fontWeight: 550 }}>
                          {t.title}
                        </div>
                        <div className="faint" style={{ marginTop: 3 }}>
                          {t.assignee?.name ?? 'Unassigned'}
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="stack">
              {/* ------------------------------------------ trust in the AI */}
              {findings.confirmed > 0 && (
                <div className="card">
                  <div className="card-head">
                    <div>
                      <h2>What we actually found</h2>
                      <span className="faint">
                        Product bugs vs problems with the generated tests
                      </span>
                    </div>
                  </div>
                  <div className="stack-sm">
                    {Object.entries(findings.byClassification)
                      .sort((a, b) => b[1] - a[1])
                      .map(([key, count]) => (
                        <div className="spread" key={key}>
                          <ClassificationBadge value={key} />
                          <strong>{count}</strong>
                        </div>
                      ))}
                  </div>

                  {Object.keys(findings.bySeverity).length > 0 && (
                    <>
                      <div className="faint" style={{ margin: '14px 0 6px' }}>
                        BY SEVERITY
                      </div>
                      <div className="stack-sm">
                        {Object.entries(findings.bySeverity)
                          .sort()
                          .map(([sev, count]) => (
                            <div className="spread" key={sev}>
                              <span className="pill">
                                {sev === 'UNSET' ? 'Not set' : (SEVERITY_LABEL[sev] ?? sev)}
                              </span>
                              <strong>{count}</strong>
                            </div>
                          ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              <div className="card">
                <div className="card-head">
                  <h2>Test plan</h2>
                </div>
                <dl className="detail-grid">
                  <dt>Total cases</dt>
                  <dd>{tests.total}</dd>
                  <dt>Approved</dt>
                  <dd>{tests.approved}</dd>
                  <dt>Human edited</dt>
                  <dd>
                    {tests.humanEdited}
                    {tests.total > 0 && (
                      <span className="faint">
                        {' '}
                        ({Math.round((tests.humanEdited / tests.total) * 100)}% needed a fix)
                      </span>
                    )}
                  </dd>
                  <dt>AI tokens</dt>
                  <dd className="faint">
                    {data.llm.tokensIn.toLocaleString()} in /{' '}
                    {data.llm.tokensOut.toLocaleString()} out
                  </dd>
                </dl>
              </div>
            </div>
          </div>

          {/* ------------------------------------------------- recent runs */}
          <div className="card">
            <div className="card-head">
              <h2>Recent runs</h2>
              <Link href="/runs" className="btn btn-sm btn-ghost">
                View all
              </Link>
            </div>
            <div className="stack-sm">
              {data.recentRuns.map((r) => (
                <Link
                  key={r.id}
                  href={`/runs/${r.id}`}
                  className="card card-tight card-link"
                  style={{ boxShadow: 'none' }}
                >
                  <div className="spread">
                    <div style={{ minWidth: 0 }}>
                      <strong>{r.name}</strong>
                      <div className="faint mono truncate" style={{ maxWidth: 460 }}>
                        {r.targetUrl}
                      </div>
                    </div>
                    <div className="row">
                      <span className="pill">{r._count.testCases} cases</span>
                      <span className="pill">{r._count.findings} findings</span>
                      <RunStatusBadge status={r.status} />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** A single stacked bar: the shape of the suite at a glance. */
function ResultBar({ tests }: { tests: DashboardOverview['tests'] }) {
  const segments = [
    { value: tests.passed, color: 'var(--pass)', label: 'passed' },
    { value: tests.failed, color: 'var(--fail)', label: 'failed' },
    { value: tests.errored, color: 'var(--warn)', label: 'errored' },
    { value: tests.flaky, color: 'var(--info)', label: 'flaky' },
  ].filter((s) => s.value > 0);

  const total = segments.reduce((a, s) => a + s.value, 0);
  if (!total) return <div className="faint">Nothing executed yet.</div>;

  return (
    <>
      <div
        style={{
          display: 'flex',
          height: 10,
          borderRadius: 6,
          overflow: 'hidden',
          background: 'var(--surface-3)',
        }}
      >
        {segments.map((s) => (
          <div
            key={s.label}
            title={`${s.value} ${s.label}`}
            style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
          />
        ))}
      </div>
      <div className="row faint" style={{ marginTop: 7, gap: 12 }}>
        {segments.map((s) => (
          <span key={s.label} className="row" style={{ gap: 5 }}>
            <span
              style={{ width: 8, height: 8, borderRadius: 2, background: s.color }}
            />
            {s.value} {s.label}
          </span>
        ))}
      </div>
    </>
  );
}

function AttentionRow({
  href,
  count,
  label,
  tone,
}: {
  href: string;
  count: number;
  label: string;
  tone: 'warn' | 'brand' | 'info' | 'fail';
}) {
  const color =
    count === 0
      ? 'var(--text-faint)'
      : tone === 'warn'
        ? 'var(--warn)'
        : tone === 'brand'
          ? 'var(--brand)'
          : tone === 'fail'
            ? 'var(--fail)'
            : 'var(--info)';

  return (
    <Link
      href={href}
      className="card card-tight card-link"
      // display is set here, not via .spread: .card-link declares display:block
      // later in the stylesheet and would win, collapsing the flex layout.
      style={{
        boxShadow: 'none',
        padding: '9px 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}
    >
      <span className={count === 0 ? 'faint' : undefined}>{label}</span>
      <strong style={{ fontSize: 19, color, lineHeight: 1 }}>{count}</strong>
    </Link>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'pass' | 'fail' | 'warn';
}) {
  const color =
    value === 0
      ? 'var(--text-faint)'
      : tone === 'pass'
        ? 'var(--pass)'
        : tone === 'fail'
          ? 'var(--fail)'
          : tone === 'warn'
            ? 'var(--warn)'
            : 'var(--text)';
  return (
    <div className="stat">
      <div className="stat-value" style={{ color }}>
        {value}
      </div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="card" style={{ padding: '40px 28px', textAlign: 'center' }}>
      <div style={{ fontSize: 30, marginBottom: 10, opacity: 0.5 }}>▶</div>
      <h2 style={{ fontSize: 19 }}>No test runs yet</h2>
      <p className="faint" style={{ maxWidth: 460, margin: '8px auto 18px' }}>
        Give the platform a page you are authorised to test and describe what should work. It reads
        the page in Chrome, proposes test cases, and you approve them before anything runs.
      </p>
      <Link href="/runs/new" className="btn btn-primary btn-lg">
        Start your first run
      </Link>
    </div>
  );
}
