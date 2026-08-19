'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { FindingCard } from '../../../components/FindingCard';
import { PageScanPanel } from '../../../components/PageScanPanel';
import { RunStatusBadge } from '../../../components/StatusBadge';
import { TestCaseCard } from '../../../components/TestCaseCard';
import {
  ApiError,
  POLL_INTERVAL_MS,
  approveAllTestCases,
  executeRun,
  getRun,
  replanRun,
} from '../../../lib/api';
import { IN_PROGRESS_STATUSES, type RunDetail } from '../../../lib/types';

/**
 * THE RUN PAGE.
 *
 * Deliberately simplified: it used to show eight stat boxes, three token pills
 * and five tabs, which buried the only two things that matter — what needs
 * doing right now, and did the tests pass.
 *
 * Now: one sentence telling you what to do, one result line, three tabs. The
 * scan, the policy rejections and the requirements all moved into a single
 * "Details" tab, because they are things you consult when something looks wrong,
 * not things you read every time.
 */

type Tab = 'cases' | 'failures' | 'details';

export default function RunPage() {
  const params = useParams<{ id: string }>();
  const runId = params.id;

  const [run, setRun] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('cases');

  /** Grace window: keep polling briefly after an action even if status lags. */
  const [forcePollUntil, setForcePollUntil] = useState(0);

  const load = useCallback(async () => {
    try {
      setRun(await getRun(runId));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [runId]);

  useEffect(() => {
    void load();
  }, [load]);

  const inProgress = run ? IN_PROGRESS_STATUSES.includes(run.status) : false;

  useEffect(() => {
    if (!run) return;
    if (!inProgress && Date.now() >= forcePollUntil) return;
    const t = setTimeout(() => void load(), POLL_INTERVAL_MS);
    return () => clearTimeout(t);
  }, [run, inProgress, forcePollUntil, load]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setActionError(null);
    try {
      await fn();
      setForcePollUntil(Date.now() + 180_000);
      await load();
    } catch (err) {
      const message = (err as ApiError).message;
      // Already running is not a failure — resume watching instead of shouting.
      if (/already executing/i.test(message)) {
        setForcePollUntil(Date.now() + 180_000);
        await load();
      } else {
        setActionError(message);
      }
    } finally {
      setBusy(null);
    }
  };

  if (error) {
    return (
      <div className="stack">
        <div className="banner banner-error">{error}</div>
        <Link href="/runs" className="btn btn-sm">
          Back to past tests
        </Link>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="empty">
        <span className="spinner" /> Loading
      </div>
    );
  }

  const s = run.summary;
  const pending = run.testCases.filter((c) => !c.approved && !c.rejected);
  const openFindings = run.findings.filter((f) =>
    ['NEW', 'TRIAGED', 'REOPENED'].includes(f.status),
  );
  const hasRun = s.executed > 0;
  const allGood = hasRun && s.failed === 0 && s.errored === 0 && s.flaky === 0;

  return (
    <div className="stack">
      {/* ============================================================ header */}
      <div className="card">
        <div className="spread">
          <div style={{ minWidth: 0 }}>
            <div className="row">
              <h1 style={{ fontSize: 22 }}>{run.name}</h1>
              <RunStatusBadge status={run.status} />
            </div>
            <a
              href={run.targetUrl}
              target="_blank"
              rel="noreferrer"
              className="mono faint"
              style={{ wordBreak: 'break-all' }}
            >
              {run.targetUrl}
            </a>
          </div>

          <div className="row">
            {pending.length > 0 && (
              <button
                className="btn"
                disabled={busy !== null}
                onClick={() => act('approveAll', () => approveAllTestCases(run.id))}
              >
                {busy === 'approveAll' ? <span className="spinner" /> : null} Approve all (
                {pending.length})
              </button>
            )}
            <button
              className="btn btn-primary btn-lg"
              disabled={busy !== null || s.approvedCases === 0 || inProgress}
              onClick={() => act('execute', () => executeRun(run.id))}
            >
              {busy === 'execute' || inProgress ? <span className="spinner" /> : null}
              {inProgress
                ? `Running ${s.executed}/${s.approvedCases}`
                : hasRun
                  ? `Run again (${s.approvedCases})`
                  : `Run ${s.approvedCases} test${s.approvedCases === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>

        {actionError && (
          <div className="banner banner-error" style={{ marginTop: 14 }}>
            {actionError}
          </div>
        )}

        {/* --------------------------------------- ONE line: what's going on */}
        <div style={{ marginTop: 16 }}>
          {inProgress ? (
            <div className="banner banner-info">
              <span className="spinner" />
              <div>
                <strong>
                  {run.status === 'SCANNING'
                    ? 'Reading the page in Chrome…'
                    : run.status === 'PLANNING'
                      ? 'The AI is writing your tests…'
                      : 'Running your tests in Chrome…'}
                </strong>
                <div style={{ fontWeight: 400, marginTop: 2 }}>
                  {run.statusMessage ?? 'This page updates by itself.'}
                </div>
              </div>
            </div>
          ) : run.status === 'SCAN_FAILED' || run.status === 'PLAN_FAILED' ? (
            <div className="banner banner-error">
              <div>
                <strong>Could not get started.</strong>
                <div style={{ fontWeight: 400, marginTop: 2 }}>{run.statusMessage}</div>
                <button
                  className="btn btn-sm"
                  style={{ marginTop: 10 }}
                  disabled={busy !== null}
                  onClick={() => act('replan', () => replanRun(run.id))}
                >
                  {busy === 'replan' ? <span className="spinner" /> : null} Try again
                </button>
              </div>
            </div>
          ) : pending.length > 0 ? (
            <div className="banner banner-warn">
              <div>
                <strong>
                  Step 1 — check the {pending.length} test{pending.length === 1 ? '' : 's'} below,
                  then press Approve all.
                </strong>
                <div style={{ fontWeight: 400, marginTop: 2 }}>
                  Nothing runs until you approve. Then press the blue Run button.
                </div>
              </div>
            </div>
          ) : !hasRun ? (
            <div className="banner banner-info">
              <div>
                <strong>Ready. Press the blue Run button.</strong>
              </div>
            </div>
          ) : allGood ? (
            <div className="banner banner-success">
              <div>
                <strong>Everything passed.</strong>
                <div style={{ fontWeight: 400, marginTop: 2 }}>
                  All {s.passed} test{s.passed === 1 ? '' : 's'} worked. Nothing to fix.
                </div>
              </div>
            </div>
          ) : (
            <div className="banner banner-error">
              <div>
                <strong>
                  {s.failed + s.errored + s.flaky} test
                  {s.failed + s.errored + s.flaky === 1 ? '' : 's'} did not pass.
                </strong>
                <div style={{ fontWeight: 400, marginTop: 2 }}>
                  Open the <strong>Failures</strong> tab to see why, with a screenshot.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* -------------------------------- ONE result line, not eight boxes */}
        {hasRun && (
          <div className="result-line">
            <ResultChip label="passed" value={s.passed} tone="pass" />
            <ResultChip label="failed" value={s.failed} tone="fail" />
            {s.errored > 0 && <ResultChip label="could not run" value={s.errored} tone="fail" />}
            {s.flaky > 0 && <ResultChip label="unreliable" value={s.flaky} tone="warn" />}
            <span className="faint" style={{ marginLeft: 'auto' }}>
              {s.executed} of {s.approvedCases} run
            </span>
          </div>
        )}
      </div>

      {/* ============================================================== tabs */}
      <div className="tabs">
        <TabButton current={tab} id="cases" onClick={setTab} count={run.testCases.length}>
          Tests
        </TabButton>
        <TabButton current={tab} id="failures" onClick={setTab} count={run.findings.length}>
          Failures
          {openFindings.length > 0 && (
            <span className="badge badge-warn">{openFindings.length} to review</span>
          )}
        </TabButton>
        <TabButton current={tab} id="details" onClick={setTab}>
          Details
        </TabButton>
      </div>

      {/* ------------------------------------------------------------- tests */}
      {tab === 'cases' && (
        <div className="stack-sm">
          {run.testCases.length === 0 ? (
            <div className="card empty">
              {inProgress ? (
                <>
                  <span className="spinner" /> Waiting for the AI to write your tests
                </>
              ) : (
                'No tests were produced. Open Details to see why.'
              )}
            </div>
          ) : (
            run.testCases.map((tc) => (
              <TestCaseCard key={tc.id} testCase={tc} onChanged={load} />
            ))
          )}
        </div>
      )}

      {/* ---------------------------------------------------------- failures */}
      {tab === 'failures' && (
        <div className="stack-sm">
          {run.findings.length === 0 ? (
            <div className="card empty">
              <div className="empty-icon">✓</div>
              {hasRun ? 'No failures. Everything passed.' : 'Nothing has run yet.'}
            </div>
          ) : (
            run.findings.map((f) => <FindingCard key={f.id} finding={f} onChanged={load} />)
          )}
        </div>
      )}

      {/* ----------------------------------------------------------- details */}
      {tab === 'details' && (
        <div className="stack">
          <div className="card">
            <div className="card-head">
              <h2>What you asked for</h2>
            </div>
            {run.requirements ? (
              <div className="logbox" style={{ maxHeight: 'none' }}>
                {run.requirements}
              </div>
            ) : (
              <div className="faint">
                No written requirements — this run used the tick-box checks only.
              </div>
            )}
            <div className="row faint" style={{ marginTop: 12 }}>
              <span className="pill">{run.hasCredentials ? 'login saved' : 'no login'}</span>
              <span className="pill">
                {run.allowDestructive ? 'delete/pay allowed' : 'delete/pay blocked'}
              </span>
              {run.llmModel && <span className="pill">AI: {run.llmModel}</span>}
              {run.llmTokensIn != null && (
                <span className="pill">
                  {run.llmTokensIn}+{run.llmTokensOut} tokens
                </span>
              )}
              <span className="pill">{new Date(run.createdAt).toLocaleString()}</span>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button
                className="btn btn-sm"
                disabled={busy !== null}
                onClick={() => act('replan', () => replanRun(run.id))}
                title="Read the page again and ask the AI for a fresh set of tests"
              >
                {busy === 'replan' ? <span className="spinner" /> : null} Rewrite the tests
              </button>
            </div>
          </div>

          {run.rejections.length > 0 && (
            <div className="card">
              <div className="card-head">
                <div>
                  <h2>Blocked or skipped</h2>
                  <span className="faint">
                    Things the safety gate refused, and what the AI said it could not test. None of
                    this reached a browser.
                  </span>
                </div>
              </div>
              <div className="scroll-x">
                <table className="data">
                  <tbody>
                    {run.rejections.map((r) => (
                      <tr key={r.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <span
                            className={`badge ${
                              r.stage === 'QUESTION_FOR_QA'
                                ? 'badge-info'
                                : r.stage === 'NOT_TESTABLE'
                                  ? 'badge-warn'
                                  : 'badge-neutral'
                            }`}
                          >
                            {r.stage.replace(/_/g, ' ').toLowerCase()}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontWeight: 550 }}>{r.subject}</div>
                          <div className="faint">{r.reason}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-head">
              <div>
                <h2>What the AI could see</h2>
                <span className="faint">
                  The AI can only use these. If a test targets the wrong thing, check here first.
                </span>
              </div>
            </div>
            {run.pageSnapshot ? (
              <PageScanPanel snapshot={run.pageSnapshot} />
            ) : (
              <div className="faint">The page has not been read yet.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** One compact chip. Replaces the eight stat boxes that dominated the header. */
function ResultChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'pass' | 'fail' | 'warn';
}) {
  const color =
    value === 0
      ? 'var(--text-faint)'
      : tone === 'pass'
        ? 'var(--pass)'
        : tone === 'fail'
          ? 'var(--fail)'
          : 'var(--warn)';
  return (
    <span className="row" style={{ gap: 6 }}>
      <strong style={{ fontSize: 19, color, fontVariantNumeric: 'tabular-nums' }}>{value}</strong>
      <span className="faint">{label}</span>
    </span>
  );
}

function TabButton({
  current,
  id,
  onClick,
  count,
  children,
}: {
  current: Tab;
  id: Tab;
  onClick: (t: Tab) => void;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`tab ${current === id ? 'tab-active' : ''}`}
      onClick={() => onClick(id)}
    >
      {children}
      {typeof count === 'number' && count > 0 && <span className="tab-count">{count}</span>}
    </button>
  );
}
