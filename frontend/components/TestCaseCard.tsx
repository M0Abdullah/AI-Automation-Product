'use client';

import { useState } from 'react';
import { useAuth } from './AuthProvider';
import {
  ApiError,
  approveTestCase,
  rejectTestCase,
  retestTestCase,
  updateTestCase,
} from '../lib/api';
import type { TestCase } from '../lib/types';
import { ResultEvidence } from './ResultEvidence';
import { PriorityBadge, ResultStatusBadge } from './StatusBadge';
import { PlannedSteps } from './StepTimeline';

/**
 * PHASE D: THE HUMAN GATE.
 *
 * One proposed test case, with everything a reviewer needs: what it will do,
 * what it asserts, which requirement it traces to, and Approve / Reject / Edit.
 *
 * Edits are sent back through the same policy validation as the AI's output, so
 * an invalid edit is refused with a readable reason rather than silently saved.
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
  const [editing, setEditing] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);

  const [title, setTitle] = useState(testCase.title);
  const [priority, setPriority] = useState(testCase.priority);
  const [stepsJson, setStepsJson] = useState(() => JSON.stringify(testCase.steps, null, 2));
  const [assertionsJson, setAssertionsJson] = useState(() =>
    JSON.stringify(testCase.assertions, null, 2),
  );

  const latest = testCase.results.length ? testCase.results[testCase.results.length - 1] : null;

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

  return (
    <div
      className="card"
      style={{
        borderLeftWidth: 3,
        borderLeftStyle: 'solid',
        borderLeftColor: testCase.rejected
          ? 'var(--neutral)'
          : testCase.approved
            ? 'var(--pass)'
            : 'var(--warn)',
        opacity: testCase.rejected ? 0.65 : 1,
      }}
    >
      <div className="card-head">
        <div style={{ minWidth: 0 }}>
          <div className="row">
            <PriorityBadge priority={testCase.priority} />
            {editing ? (
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                style={{ maxWidth: 420 }}
              />
            ) : (
              <strong>{testCase.title}</strong>
            )}
            {testCase.source === 'MANUAL' && <span className="pill">edited by human</span>}
            {testCase.destructive && <span className="badge badge-fail">destructive</span>}
            {testCase.approved && <span className="badge badge-pass">approved</span>}
            {testCase.rejected && <span className="badge badge-neutral">rejected</span>}
            {latest && <ResultStatusBadge status={latest.status} />}
          </div>

          {testCase.requirement && (
            <div className="faint" style={{ marginTop: 4 }}>
              Requirement: {testCase.requirement}
            </div>
          )}
          {testCase.rationale && (
            <div className="faint" style={{ marginTop: 2 }}>
              Why: {testCase.rationale}
            </div>
          )}
          {testCase.rejectionReason && (
            <div className="faint" style={{ marginTop: 2 }}>
              Rejected: {testCase.rejectionReason}
            </div>
          )}
        </div>

        <div className="row">
          {!testCase.approved && !testCase.rejected && canWrite && (
            <button
              className="btn btn-sm btn-primary"
              disabled={busy !== null}
              onClick={() => act('approve', () => approveTestCase(testCase.id))}
            >
              {busy === 'approve' ? <span className="spinner" /> : null} Approve
            </button>
          )}
          {!testCase.rejected && canWrite && (
            <button
              className="btn btn-sm btn-danger"
              disabled={busy !== null}
              onClick={() =>
                act('reject', () =>
                  rejectTestCase(
                    testCase.id,
                    window.prompt('Why are you rejecting this test case?') ?? undefined,
                  ),
                )
              }
            >
              Reject
            </button>
          )}
          {testCase.rejected && canWrite && (
            <button
              className="btn btn-sm"
              disabled={busy !== null}
              onClick={() => act('approve', () => approveTestCase(testCase.id))}
            >
              Restore
            </button>
          )}
          <button
            className="btn btn-sm"
            disabled={busy !== null}
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? 'Cancel edit' : 'Edit'}
          </button>
          {latest && (
            <button
              className="btn btn-sm"
              disabled={busy !== null}
              onClick={() => act('retest', () => retestTestCase(testCase.id))}
              title="Re-run just this test - use after a developer says it is fixed"
            >
              {busy === 'retest' ? <span className="spinner" /> : null} Retest
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="banner banner-error" style={{ marginBottom: 10 }}>
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

      {editing ? (
        <div className="stack">
          <label className="field" style={{ marginBottom: 0 }}>
            <span className="field-label">Priority</span>
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="P0">P0 - blocker</option>
              <option value="P1">P1 - high</option>
              <option value="P2">P2 - medium</option>
              <option value="P3">P3 - low</option>
            </select>
          </label>
          <label className="field" style={{ marginBottom: 0 }}>
            <span className="field-label">Steps (JSON)</span>
            <span className="field-hint">
              Allowed actions: goto, click, fill, select, check, uncheck, press, hover, waitForUrl,
              waitForVisible. Use valueRef for credentials.
            </span>
            <textarea rows={10} value={stepsJson} onChange={(e) => setStepsJson(e.target.value)} />
          </label>
          <label className="field" style={{ marginBottom: 0 }}>
            <span className="field-label">Assertions (JSON)</span>
            <span className="field-hint">
              Allowed: urlContains, urlNotContains, visible, notVisible, textContains,
              textNotContains, valueEquals, titleContains, elementCountAtLeast, noConsoleErrors,
              noApiErrors.
            </span>
            <textarea
              rows={8}
              value={assertionsJson}
              onChange={(e) => setAssertionsJson(e.target.value)}
            />
          </label>
          <div className="row">
            <button className="btn btn-primary btn-sm" disabled={busy !== null} onClick={save}>
              {busy === 'save' ? <span className="spinner" /> : null} Save and re-validate
            </button>
            <span className="faint">
              Your edit goes through the same policy checks as the AI&apos;s output.
            </span>
          </div>
        </div>
      ) : (
        <details className="collapse" open={!latest}>
          <summary>
            {testCase.steps.length} steps, {testCase.assertions.length} assertions
          </summary>
          <PlannedSteps steps={testCase.steps} assertions={testCase.assertions} />
        </details>
      )}

      {testCase.results.length > 0 && (
        <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div className="spread">
            <div className="row">
              {testCase.results.map((r) => (
                <span key={r.id} className="row" style={{ gap: 4 }}>
                  <span className="faint">attempt {r.attempt}:</span>
                  <ResultStatusBadge status={r.status} />
                </span>
              ))}
            </div>
            <button className="btn btn-sm btn-ghost" onClick={() => setShowEvidence((v) => !v)}>
              {showEvidence ? 'Hide evidence' : 'View evidence'}
            </button>
          </div>

          {showEvidence && latest && (
            <div style={{ marginTop: 10 }}>
              <ResultEvidence resultId={latest.id} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
