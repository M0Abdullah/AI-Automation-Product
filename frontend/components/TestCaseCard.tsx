'use client';

import { useState } from 'react';
import {
  ApiError,
  approveTestCase,
  rejectTestCase,
  retestTestCase,
  updateTestCase,
} from '../lib/api';
import type { TestCase } from '../lib/types';
import { useAuth } from './AuthProvider';
import { ResultEvidence } from './ResultEvidence';
import { PriorityBadge, ResultStatusBadge } from './StatusBadge';
import { PlannedSteps } from './StepTimeline';

/**
 * ONE TEST, AS ONE LINE.
 *
 * This card used to open with every step, every assertion and a paragraph of
 * rationale — eight of them made a page nobody could scan. Now it shows a single
 * plain-English summary and hides the detail until asked.
 *
 * The detail is one click away, never removed: a reviewer approving a machine's
 * test must always be able to see exactly what it will do.
 */
export function TestCaseCard({
  testCase,
  onChanged,
}: {
  testCase: TestCase;
  onChanged: () => void;
}) {
  const { canWrite } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);

  const [title, setTitle] = useState(testCase.title);
  const [priority, setPriority] = useState(testCase.priority);
  const [stepsJson, setStepsJson] = useState(() => JSON.stringify(testCase.steps, null, 2));
  const [assertionsJson, setAssertionsJson] = useState(() =>
    JSON.stringify(testCase.assertions, null, 2),
  );

  const latest = testCase.results.length ? testCase.results[testCase.results.length - 1] : null;
  const failed = latest && latest.status !== 'PASS';

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    setDetails([]);
    try {
      await fn();
      onChanged();
    } catch (err) {
      const e = err as ApiError;
      setError(e.message);
      if (Array.isArray(e.details)) setDetails(e.details as string[]);
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    act('save', async () => {
      let steps: unknown;
      let assertions: unknown;
      try {
        steps = JSON.parse(stepsJson);
        assertions = JSON.parse(assertionsJson);
      } catch {
        throw new ApiError('Steps or assertions are not valid JSON.', 400, 'CLIENT_JSON');
      }
      await updateTestCase(testCase.id, {
        title,
        priority,
        steps: steps as TestCase['steps'],
        assertions: assertions as TestCase['assertions'],
      });
      setEditing(false);
    });

  const accent = failed
    ? 'var(--fail)'
    : latest
      ? 'var(--pass)'
      : testCase.rejected
        ? 'var(--neutral)'
        : testCase.approved
          ? 'var(--brand)'
          : 'var(--warn)';

  return (
    <div
      className="card card-tight"
      style={{
        borderLeft: `3px solid ${accent}`,
        opacity: testCase.rejected ? 0.6 : 1,
      }}
    >
      {/* ------------------------------------------------------- the one line */}
      <div className="spread" style={{ gap: 10 }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            background: 'none',
            border: 'none',
            padding: 0,
            font: 'inherit',
            color: 'inherit',
            cursor: 'pointer',
            textAlign: 'left',
            minWidth: 0,
            flex: 1,
          }}
          title={open ? 'Hide the detail' : 'Show what this test does'}
        >
          <span className="faint" style={{ width: 10, flexShrink: 0 }}>
            {open ? '▾' : '▸'}
          </span>
          <PriorityBadge priority={testCase.priority} />
          <span style={{ fontWeight: 570, minWidth: 0 }}>{testCase.title}</span>
          {latest && <ResultStatusBadge status={latest.status} />}
          {!latest && testCase.approved && <span className="badge badge-brand">approved</span>}
          {!latest && !testCase.approved && !testCase.rejected && (
            <span className="badge badge-warn">needs review</span>
          )}
          {testCase.rejected && <span className="badge badge-neutral">skipped</span>}
          {testCase.destructive && <span className="badge badge-fail">risky</span>}
        </button>

        <div className="row" style={{ gap: 6 }}>
          {canWrite && !testCase.approved && !testCase.rejected && (
            <button
              className="btn btn-sm btn-primary"
              disabled={busy !== null}
              onClick={() => act('approve', () => approveTestCase(testCase.id))}
            >
              {busy === 'approve' ? <span className="spinner" /> : null} Approve
            </button>
          )}
          {canWrite && !testCase.rejected && (
            <button
              className="btn btn-sm btn-ghost"
              disabled={busy !== null}
              onClick={() =>
                act('reject', () =>
                  rejectTestCase(
                    testCase.id,
                    window.prompt('Why are you skipping this test?') ?? undefined,
                  ),
                )
              }
              title="Do not run this test"
            >
              Skip
            </button>
          )}
          {canWrite && testCase.rejected && (
            <button
              className="btn btn-sm"
              disabled={busy !== null}
              onClick={() => act('approve', () => approveTestCase(testCase.id))}
            >
              Restore
            </button>
          )}
          {latest && (
            <button
              className="btn btn-sm btn-ghost"
              disabled={busy !== null}
              onClick={() => act('retest', () => retestTestCase(testCase.id))}
              title="Run just this one test again"
            >
              {busy === 'retest' ? <span className="spinner" /> : null} Retry
            </button>
          )}
        </div>
      </div>

      {/* ------------------------ the failure reason, always visible if failed */}
      {failed && latest?.errorMessage && (
        <div
          className="faint"
          style={{ marginTop: 8, marginLeft: 19, color: 'var(--fail)', lineHeight: 1.5 }}
        >
          {latest.errorMessage.slice(0, 220)}
        </div>
      )}

      {error && (
        <div className="banner banner-error" style={{ marginTop: 10 }}>
          <div>
            <strong>{error}</strong>
            {details.length > 0 && (
              <ul style={{ margin: '5px 0 0 16px' }}>
                {details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------- the detail */}
      {open && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          {testCase.requirement && (
            <div className="faint" style={{ marginBottom: 10 }}>
              Checks: {testCase.requirement}
            </div>
          )}
          {testCase.rejectionReason && (
            <div className="faint" style={{ marginBottom: 10 }}>
              Skipped because: {testCase.rejectionReason}
            </div>
          )}

          {editing ? (
            <div className="stack-sm">
              <label className="field" style={{ marginBottom: 0 }}>
                <span className="field-label">Title</span>
                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label className="field" style={{ marginBottom: 0 }}>
                <span className="field-label">Priority</span>
                <select value={priority} onChange={(e) => setPriority(e.target.value)}>
                  <option value="P0">P0 — blocks release</option>
                  <option value="P1">P1 — important</option>
                  <option value="P2">P2 — normal</option>
                  <option value="P3">P3 — minor</option>
                </select>
              </label>
              <label className="field" style={{ marginBottom: 0 }}>
                <span className="field-label">What it does (JSON)</span>
                <textarea
                  rows={8}
                  value={stepsJson}
                  onChange={(e) => setStepsJson(e.target.value)}
                />
              </label>
              <label className="field" style={{ marginBottom: 0 }}>
                <span className="field-label">What it checks (JSON)</span>
                <textarea
                  rows={6}
                  value={assertionsJson}
                  onChange={(e) => setAssertionsJson(e.target.value)}
                />
              </label>
              <div className="row">
                <button className="btn btn-sm btn-primary" disabled={busy !== null} onClick={save}>
                  {busy === 'save' ? <span className="spinner" /> : null} Save
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => setEditing(false)}>
                  Cancel
                </button>
                <span className="faint">
                  Your edit goes through the same safety checks as the AI&apos;s.
                </span>
              </div>
            </div>
          ) : (
            <>
              <PlannedSteps steps={testCase.steps} assertions={testCase.assertions} />
              <div className="row" style={{ marginTop: 10 }}>
                {canWrite && (
                  <button className="btn btn-sm btn-ghost" onClick={() => setEditing(true)}>
                    Edit this test
                  </button>
                )}
                {latest && (
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => setShowEvidence((v) => !v)}
                  >
                    {showEvidence ? 'Hide' : 'Show'} what happened
                  </button>
                )}
              </div>
            </>
          )}

          {showEvidence && latest && (
            <div style={{ marginTop: 12 }}>
              <ResultEvidence resultId={latest.id} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
