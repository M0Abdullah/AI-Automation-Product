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

type Tab = 'cases' | 'findings' | 'scan' | 'rejected' | 'requirements';

export default function RunPage() {
  const params = useParams<{ id: string }>();
  const runId = params.id;

  const [run, setRun] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('cases');

  const load = useCallback(async () => {
    try {
      const data = await getRun(runId);
      setRun(data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [runId]);

  // Poll while the backend is still working. Stops as soon as it is idle, so an
  // finished run costs nothing.
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!run || !IN_PROGRESS_STATUSES.includes(run.status)) return;
    const t = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [run, load]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setActionError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setActionError((err as ApiError).message);
    } finally {
      setBusy(null);
    }
  };

  if (error) {
    return (
      <div className="stack">
        <div className="banner banner-error">{error}</div>
        <Link href="/" className="btn btn-sm">
          Back to runs
        </Link>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="empty">
        <span className="spinner" /> Loading run
      </div>
    );
  }

  const s = run.summary;
  const pending = run.testCases.filter((c) => !c.approved && !c.rejected);
  const canExecute = s.approvedCases > 0 && run.status !== 'RUNNING';
  const openFindings = run.findings.filter((f) =>
    ['NEW', 'TRIAGED', 'REOPENED'].includes(f.status),
  );

  return (
    <div className="stack">
      {/* ----------------------------------------------------------- header */}
      <div className="card">
        <div className="spread">
          <div style={{ minWidth: 0 }}>
            <div className="row">
              <h1>{run.name}</h1>
              <RunStatusBadge status={run.status} />
            </div>
            <a
              href={run.targetUrl}
              target="_blank"
              rel="noreferrer"
              className="mono"
              style={{ wordBreak: 'break-all' }}
            >
              {run.targetUrl}
            </a>
            {run.statusMessage && (
              <div className="faint" style={{ marginTop: 4 }}>
                {run.statusMessage}
              </div>
            )}
          </div>

          <div className="row">
            <button
              className="btn btn-sm"
              disabled={busy !== null}
              onClick={() => act('replan', () => replanRun(run.id))}
              title="Scan the page again and ask the model for a fresh plan"
            >
              {busy === 'replan' ? <span className="spinner" /> : null} Re-plan
            </button>
            {pending.length > 0 && (
              <button
                className="btn btn-sm"
                disabled={busy !== null}
                onClick={() => act('approveAll', () => approveAllTestCases(run.id))}
              >
                {busy === 'approveAll' ? <span className="spinner" /> : null} Approve all (
                {pending.length})
              </button>
            )}
            <button
              className="btn btn-primary"
              disabled={busy !== null || !canExecute}
              onClick={() => act('execute', () => executeRun(run.id))}
              title={
                canExecute ? 'Run every approved test case' : 'Approve at least one test case first'
              }
            >
              {busy === 'execute' || run.status === 'RUNNING' ? <span className="spinner" /> : null}
              {run.status === 'RUNNING' ? 'Running' : `Run ${s.approvedCases} approved test(s)`}
            </button>
          </div>
        </div>

        {actionError && (
          <div className="banner banner-error" style={{ marginTop: 12 }}>
            {actionError}
          </div>
        )}

        {/* ------------------------------------------------------- summary */}
        <div className="stats" style={{ marginTop: 14 }}>
          <Stat label="Cases" value={s.totalCases} />
          <Stat label="Approved" value={s.approvedCases} />
          <Stat label="Passed" value={s.passed} tone="pass" />
          <Stat label="Failed" value={s.failed} tone="fail" />
          <Stat label="Errored" value={s.errored} tone="fail" />
          <Stat label="Flaky" value={s.flaky} tone="warn" />
          <Stat label="Open findings" value={s.openFindings} tone="warn" />
          <Stat label="Confirmed" value={s.confirmedFindings} tone="fail" />
        </div>

        <div className="row faint" style={{ marginTop: 10 }}>
          {run.llmModel && <span className="pill">model {run.llmModel}</span>}
          {run.llmTokensIn != null && (
            <span className="pill">
              {run.llmTokensIn} in / {run.llmTokensOut} out tokens
            </span>
          )}
          {run.llmLatencyMs != null && <span className="pill">{run.llmLatencyMs}ms planning</span>}
          <span className="pill">{run.hasCredentials ? 'credentials stored' : 'no credentials'}</span>
          <span className="pill">
            {run.allowDestructive ? 'destructive allowed' : 'destructive blocked'}
          </span>
        </div>
      </div>

      {/* ------------------------------------------------ status explanations */}
      {run.status === 'AWAITING_APPROVAL' && pending.length > 0 && (
        <div className="banner banner-info">
          <div>
            <strong>{pending.length} test case(s) need your review.</strong> Nothing runs until you
            approve. Check that each assertion matches a requirement you actually wrote.
          </div>
        </div>
      )}
      {run.status === 'SCAN_FAILED' && (
        <div className="banner banner-error">
          <div>
            <strong>Could not read the page.</strong> Common causes: the URL needs a login, the site
            blocks automated browsers, or the page renders after a long delay. Try a simpler page
            first.
          </div>
        </div>
      )}
      {run.status === 'PLAN_FAILED' && (
        <div className="banner banner-error">
          <div>
            <strong>Test planning failed.</strong> Check the &quot;Rejected by policy&quot; tab, and
            run <code>npm run check:llm</code> in the backend to verify the model id and key.
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------- tabs */}
      <div className="tabs">
        <TabButton current={tab} id="cases" onClick={setTab} count={run.testCases.length}>
          Test cases
        </TabButton>
        <TabButton current={tab} id="findings" onClick={setTab} count={run.findings.length}>
          Findings
          {openFindings.length > 0 && (
            <span className="badge badge-warn">{openFindings.length} open</span>
          )}
        </TabButton>
        <TabButton
          current={tab}
          id="scan"
          onClick={setTab}
          count={run.pageSnapshot?.elements.length ?? 0}
        >
          What the AI saw
        </TabButton>
        <TabButton current={tab} id="rejected" onClick={setTab} count={run.rejections.length}>
          Rejected by policy
        </TabButton>
        <TabButton current={tab} id="requirements" onClick={setTab}>
          Requirements
        </TabButton>
      </div>

      {/* ------------------------------------------------------- tab: cases */}
      {tab === 'cases' && (
        <div className="stack">
          {run.testCases.length === 0 ? (
            <div className="empty">
              {IN_PROGRESS_STATUSES.includes(run.status) ? (
                <>
                  <span className="spinner" /> Waiting for the AI to propose test cases
                </>
              ) : (
                'No test cases were produced.'
              )}
            </div>
          ) : (
            run.testCases.map((tc) => (
              <TestCaseCard key={tc.id} testCase={tc} onChanged={load} />
            ))
          )}
        </div>
      )}

      {/* ---------------------------------------------------- tab: findings */}
      {tab === 'findings' && (
        <div className="stack">
          {run.findings.length === 0 ? (
            <div className="empty">
              No findings. Either nothing has run yet, or everything passed.
            </div>
          ) : (
            <>
              <div className="banner banner-info">
                <div>
                  A finding is a <strong>failure awaiting your judgement</strong>, not a bug. Confirm
                  it, reject it, or reopen it later if it comes back.
                </div>
              </div>
              {run.findings.map((f) => (
                <FindingCard key={f.id} finding={f} onChanged={load} />
              ))}
            </>
          )}
        </div>
      )}

      {/* -------------------------------------------------------- tab: scan */}
      {tab === 'scan' && (
        <>
          {run.pageSnapshot ? (
            <PageScanPanel snapshot={run.pageSnapshot} />
          ) : (
            <div className="empty">The page has not been scanned yet.</div>
          )}
        </>
      )}

      {/* ---------------------------------------------------- tab: rejected */}
      {tab === 'rejected' && (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Rejected by policy</h2>
              <span className="faint">
                Everything the safety gate refused, plus what the model said it could not test.
                Nothing here ever reached a browser.
              </span>
            </div>
          </div>
          {run.rejections.length === 0 ? (
            <div className="empty">Nothing was rejected.</div>
          ) : (
            <div className="scroll-x">
              <table className="data">
                <thead>
                  <tr>
                    <th>Stage</th>
                    <th>Subject</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {run.rejections.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <span
                          className={`badge ${
                            r.stage === 'QUESTION_FOR_QA'
                              ? 'badge-info'
                              : r.stage === 'NOT_TESTABLE'
                                ? 'badge-warn'
                                : 'badge-neutral'
                          }`}
                        >
                          {r.stage}
                        </span>
                      </td>
                      <td className="mono">{r.subject}</td>
                      <td>{r.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------ tab: requirements */}
      {tab === 'requirements' && (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Requirements</h2>
              <span className="faint">
                The source of truth. The model is instructed never to assert anything that is not
                stated here.
              </span>
            </div>
          </div>
          <div className="logbox" style={{ maxHeight: 'none' }}>
            {run.requirements}
          </div>
        </div>
      )}
    </div>
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
      className={`tab ${current === id ? 'tab-active' : ''}`}
      onClick={() => onClick(id)}
      type="button"
    >
      {children}
      {typeof count === 'number' && <span className="tab-count">{count}</span>}
    </button>
  );
}
