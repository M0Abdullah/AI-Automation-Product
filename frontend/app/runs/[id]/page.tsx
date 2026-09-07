'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ContentIssuesPanel } from '../../../components/ContentIssuesPanel';
import { DesignIssuesPanel } from '../../../components/DesignIssuesPanel';
import { FindingCard } from '../../../components/FindingCard';
import { PageScanPanel } from '../../../components/PageScanPanel';
import { RunStatusBadge } from '../../../components/StatusBadge';
import { TestCaseCard } from '../../../components/TestCaseCard';
import { RunPagesPanel } from '../../../components/RunPagesPanel';
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

type Tab = 'cases' | 'pages' | 'failures' | 'wording' | 'design' | 'details';

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
  // Dismissed suggestions do not count towards the tab badge - once a reviewer
  // has said "that is our product name", it should stop asking for attention.
  const wordingCount = (run.contentIssues ?? []).filter((i) => i.status !== 'DISMISSED').length;
  // The Design tab appears whenever a Figma frame was given, even with zero
  // mismatches - "it matches the design" is a result worth seeing, and hiding
  // the tab would leave the user unsure the check ran at all.
  const designRan = Boolean(run.figmaFileKey && run.figmaNodeId);
  const designCount = (run.designIssues ?? []).filter((i) => i.status !== 'DISMISSED').length;
  const hasRun = s.executed > 0;
  const allGood = hasRun && s.failed === 0 && s.errored === 0 && s.flaky === 0;

  // WHOLE-APP MODE. A single-page run still has one RunPage, so the switch is
  // on the count rather than on run.crawlEnabled - that way a crawl that only
  // found one page reads as the single-page run it effectively is.
  const pages = run.pages ?? [];
  const multiPage = pages.length > 1;
  const pagesFailed = s.pagesFailed ?? 0;
  // Links the crawler chose not to follow. Same table as the policy
  // rejections, different question, so they are split apart for display.
  const crawlSkipped = run.rejections.filter((r) => r.stage === 'CRAWL_SKIPPED');
  const policyRejections = run.rejections.filter((r) => r.stage !== 'CRAWL_SKIPPED');

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
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <a
                href={run.targetUrl}
                target="_blank"
                rel="noreferrer"
                className="mono faint"
                style={{ wordBreak: 'break-all' }}
              >
                {run.targetUrl}
              </a>
              {multiPage && (
                <span className="pill" title="This run covers the whole app">
                  whole app &middot; {pages.length} pages
                </span>
              )}
            </div>
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
                ? 'Running…'
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
            <div className="banner banner-info" style={{ display: 'block' }}>
              <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                <span className="spinner" style={{ marginTop: 4 }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <strong>
                    {run.status === 'SCANNING'
                      ? run.crawlEnabled && !pages.length
                        ? 'Finding the pages of your app in Chrome…'
                        : multiPage
                          ? `Reading ${pages.length} pages in Chrome…`
                          : 'Reading the page in Chrome…'
                      : run.status === 'PLANNING'
                        ? 'The AI is writing your tests…'
                        : `Testing ${Math.min(s.executed + 1, s.approvedCases)} of ${s.approvedCases} in Chrome…`}
                  </strong>
                  <div style={{ fontWeight: 400, marginTop: 2 }}>
                    {/* Strip the leading "Running 1/7: " the backend prefixes, so
                        the count is not stated twice with different numbers. */}
                    {run.statusMessage?.replace(/^Running \d+\/\d+:\s*/, '') ??
                      'This page updates by itself.'}
                  </div>

                  {run.status === 'RUNNING' && s.approvedCases > 0 && (
                    <div className="progress" style={{ marginTop: 10 }}>
                      <div
                        className="progress-fill"
                        style={{ width: `${(s.executed / s.approvedCases) * 100}%` }}
                      />
                    </div>
                  )}
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
        {/* Only when the run covers more than one page. On a single-page run
            the tab would restate the header and nothing else. */}
        {multiPage && (
          <TabButton current={tab} id="pages" onClick={setTab} count={pages.length}>
            Pages
            {pagesFailed > 0 && (
              <span className="badge badge-fail badge-plain">{pagesFailed} not tested</span>
            )}
          </TabButton>
        )}
        <TabButton current={tab} id="failures" onClick={setTab} count={run.findings.length}>
          Failures
          {openFindings.length > 0 && (
            <span className="badge badge-warn badge-plain">{openFindings.length} to review</span>
          )}
        </TabButton>
        {/* Only offered when there is something to review. An always-visible
            empty tab trains people to ignore it. */}
        {wordingCount > 0 && (
          <TabButton current={tab} id="wording" onClick={setTab} count={wordingCount}>
            Wording
          </TabButton>
        )}
        {designRan && (
          <TabButton current={tab} id="design" onClick={setTab} count={designCount}>
            Design
          </TabButton>
        )}
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
          ) : multiPage ? (
            /*
              GROUPED BY PAGE.
              A flat list of 40 cases across 9 screens is unreviewable: the
              reviewer cannot tell whether a case belongs on the page it names,
              which is the single judgement approval asks for. The page heading
              supplies that context once instead of per card.
            */
            groupByPage(run.testCases, pages).map(([page, cases]) => (
              <div key={page.key} className="stack-sm">
                <div className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
                  <strong className="mono">{page.path}</strong>
                  <span className="faint">
                    {cases.length} test{cases.length === 1 ? '' : 's'}
                  </span>
                  {page.title && <span className="faint">&middot; {page.title}</span>}
                </div>
                {cases.map((tc) => (
                  <TestCaseCard key={tc.id} testCase={tc} onChanged={load} />
                ))}
              </div>
            ))
          ) : (
            run.testCases.map((tc) => (
              <TestCaseCard key={tc.id} testCase={tc} onChanged={load} />
            ))
          )}

          {/* The honest caveat, on the tab where approval happens. */}
          {multiPage && pagesFailed > 0 && (
            <div className="banner banner-warn">
              <div>
                <strong>
                  {pagesFailed} of {pages.length} pages have no tests.
                </strong>
                <div style={{ fontWeight: 400, marginTop: 2 }}>
                  A green result below says nothing about {pagesFailed === 1 ? 'it' : 'them'}.
                  Open the <strong>Pages</strong> tab for the reason against each one.
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------- pages */}
      {tab === 'pages' && (
        <div className="card">
          <RunPagesPanel runId={run.id} pages={pages} skipped={crawlSkipped} />
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

      {/* ----------------------------------------------------------- wording */}
      {tab === 'wording' && (
        <div className="card">
          <ContentIssuesPanel
            issues={run.contentIssues ?? []}
            showPage={multiPage}
            onPromoted={load}
          />
        </div>
      )}

      {/* ------------------------------------------------------------ design */}
      {tab === 'design' && (
        <div className="card">
          <DesignIssuesPanel
            issues={run.designIssues ?? []}
            summary={run.designSpecSummary}
            // Stated explicitly, because on a whole-app run the natural
            // assumption is that every page was checked - and it was not.
            pageUrl={multiPage ? (run.designPageUrl ?? run.targetUrl) : null}
            onPromoted={load}
          />
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
            {/* Proof the sign-in worked. Without this the user has no way to
                tell whether the tests ran as a signed-in user or as a visitor,
                which is the difference between a real result and a page of
                assertions about a login screen. */}
            {run.loginUrl && (
              <div className="card card-tight" style={{ marginTop: 12, background: 'var(--surface-2)' }}>
                <div className="row" style={{ marginBottom: 4 }}>
                  <span className="badge badge-pass">Signed in first</span>
                  <span className="mono faint">{run.loginUrl}</span>
                </div>
                <div className="faint">
                  {run.sessionEvidence
                    ? `Confirmed: ${run.sessionEvidence}. The same session was reused for every test.`
                    : 'Signing in — the tests will run as this user.'}
                </div>
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

          {policyRejections.length > 0 && (
            <div className="card">
              <div className="card-head">
                <div>
                  <h2>Blocked or skipped</h2>
                  <span className="faint">
                    Things the safety gate refused, and what the AI said it could not test. None of
                    this reached a browser.
                    {multiPage
                      ? ' Links the crawler chose not to follow are listed under Pages instead.'
                      : ''}
                  </span>
                </div>
              </div>
              <div className="scroll-x">
                <table className="data">
                  <tbody>
                    {policyRejections.map((r) => (
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
                          {/* Which page's plan this came from. On a whole-app
                              run "the model could not test this" is meaningless
                              without knowing where. */}
                          {multiPage && r.pageUrl && (
                            <div className="faint mono" style={{ fontSize: 11, marginTop: 3 }}>
                              {new URL(r.pageUrl).pathname}
                            </div>
                          )}
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

/**
 * Test cases bucketed by the page they were written for, in crawl order.
 *
 * Cases whose page is missing (hand-written, or from a run that predates
 * whole-app mode) are collected under the entry page rather than dropped - a
 * test that vanishes from the list is far worse than one filed slightly wrong.
 */
function groupByPage(
  cases: RunDetail['testCases'],
  pages: RunDetail['pages'],
): Array<[{ key: string; path: string; title?: string | null }, RunDetail['testCases']]> {
  const order = new Map(pages.map((p, i) => [p.id, i]));
  const buckets = new Map<string, RunDetail['testCases']>();

  const fallback = pages.find((p) => p.isEntry) ?? pages[0];
  for (const c of cases) {
    const key = c.pageId && order.has(c.pageId) ? c.pageId : (fallback?.id ?? 'unknown');
    const list = buckets.get(key) ?? [];
    list.push(c);
    buckets.set(key, list);
  }

  return [...buckets.entries()]
    .sort((a, b) => (order.get(a[0]) ?? 999) - (order.get(b[0]) ?? 999))
    .map(([id, list]) => {
      const page = pages.find((p) => p.id === id);
      return [
        { key: id, path: page?.path ?? 'Other tests', title: page?.title },
        list,
      ] as [{ key: string; path: string; title?: string | null }, RunDetail['testCases']];
    });
}
