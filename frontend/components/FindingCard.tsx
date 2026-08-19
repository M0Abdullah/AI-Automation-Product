'use client';

import { useState } from 'react';
import {
  ApiError,
  closeFinding,
  commentOnFinding,
  reopenFinding,
  retestTestCase,
  triageFinding,
} from '../lib/api';
import type { Finding } from '../lib/types';
import { useAuth } from './AuthProvider';
import { BugReportActions } from './BugReportActions';
import { CreateTicketDialog } from './CreateTicketDialog';
import { ResultEvidence } from './ResultEvidence';
import {
  ClassificationBadge,
  FindingStatusBadge,
  PriorityBadge,
  TicketStatusBadge,
} from './StatusBadge';

/**
 * THE QA WORKFLOW, ON SCREEN.
 *
 * A failure is a "finding", not a bug. This card is where a human turns it into
 * one - or says it is not one:
 *
 *   Confirm  -> it is a real product defect
 *   Reject   -> it is a test defect / environment / data problem
 *   Reopen   -> it came back after being closed or wrongly rejected
 *   Close    -> done
 *   Comment  -> note without changing status
 *
 * The AI's opinion is shown clearly labelled as a suggestion, never as a verdict.
 */

const CLASSIFICATIONS = [
  { value: 'PRODUCT_BUG', label: 'Product bug - the app is wrong' },
  { value: 'TEST_DEFECT', label: 'Test defect - the generated test is wrong' },
  { value: 'ENVIRONMENT_ISSUE', label: 'Environment - outage, deploy, cert' },
  { value: 'TEST_DATA_ISSUE', label: 'Test data - missing or stale data' },
  { value: 'FLAKY', label: 'Flaky - timing dependent' },
  { value: 'UNKNOWN', label: 'Unknown - needs more investigation' },
];

const SEVERITIES = [
  { value: 'S1_BLOCKER', label: 'S1 - Blocker' },
  { value: 'S2_MAJOR', label: 'S2 - Major' },
  { value: 'S3_MINOR', label: 'S3 - Minor' },
  { value: 'S4_TRIVIAL', label: 'S4 - Trivial' },
];

export function FindingCard({
  finding,
  onChanged,
}: {
  finding: Finding;
  onChanged: () => void;
}) {
  const { canWrite, user } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const [showTriage, setShowTriage] = useState(false);
  const [showTicket, setShowTicket] = useState(false);

  // Bug-report fields captured at triage time, so the report is complete
  // the moment the defect is confirmed rather than filled in later.
  const [module, setModule] = useState(finding.module ?? '');
  const [build, setBuild] = useState(finding.build ?? '');
  const [priority, setPriority] = useState(
    finding.priority ?? finding.testCase.priority ?? 'P2',
  );

  // Pre-select the AI's suggestion so the common case is one click - but the
  // human still has to press the button.
  const [classification, setClassification] = useState<string>(
    finding.humanClassification ?? finding.aiClassification ?? 'UNKNOWN',
  );
  const [severity, setSeverity] = useState(finding.severity ?? 'S2_MAJOR');
  const [note, setNote] = useState('');

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      setNote('');
      setShowTriage(false);
      onChanged();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(null);
    }
  };

  const open = ['NEW', 'TRIAGED', 'REOPENED'].includes(finding.status);
  const evidence = finding.aiEvidence;

  return (
    <div
      className="card"
      style={{
        borderLeftWidth: 3,
        borderLeftStyle: 'solid',
        borderLeftColor:
          finding.status === 'CONFIRMED' || finding.status === 'REOPENED'
            ? 'var(--fail)'
            : finding.status === 'CLOSED'
              ? 'var(--pass)'
              : finding.status === 'REJECTED'
                ? 'var(--neutral)'
                : 'var(--warn)',
      }}
    >
      <div className="card-head">
        <div style={{ minWidth: 0 }}>
          <div className="row">
            {finding.bugKey && <span className="pill pill-key">{finding.bugKey}</span>}
            <FindingStatusBadge status={finding.status} />
            <PriorityBadge priority={finding.priority ?? finding.testCase.priority} />
            <strong>{finding.testCase.title}</strong>
          </div>
          {(finding.module || finding.build || finding.ticket) && (
            <div className="row" style={{ marginTop: 5 }}>
              {finding.module && <span className="pill">module: {finding.module}</span>}
              {finding.build && <span className="pill">build: {finding.build}</span>}
              {finding.ticket && (
                <>
                  <span className="pill pill-key">{finding.ticket.key}</span>
                  <TicketStatusBadge status={finding.ticket.status} />
                  {finding.ticket.externalUrl && (
                    <a
                      className="pill"
                      href={finding.ticket.externalUrl}
                      target="_blank"
                      rel="noreferrer"
                      title="Open in the external tracker"
                    >
                      {finding.ticket.externalKey} &#8599;
                    </a>
                  )}
                </>
              )}
            </div>
          )}
          <div className="row faint" style={{ marginTop: 4 }}>
            <span>
              seen {finding.occurrences}×, last {new Date(finding.lastSeenAt).toLocaleString()}
            </span>
            {finding.triagedBy && <span>· triaged by {finding.triagedBy}</span>}
          </div>
        </div>
        <div className="row">
          <button className="btn btn-sm btn-ghost" onClick={() => setShowEvidence((v) => !v)}>
            {showEvidence ? 'Hide evidence' : 'Evidence'}
          </button>
          <button
            className="btn btn-sm"
            disabled={busy !== null}
            onClick={() => act('retest', () => retestTestCase(finding.testCase.id))}
            title="Re-run the linked test - the Ready for Retest action"
          >
            {busy === 'retest' ? <span className="spinner" /> : null} Retest
          </button>
        </div>
      </div>

      {error && <div className="banner banner-error" style={{ marginBottom: 10 }}>{error}</div>}

      {/* --------------------------------------------- the AI suggestion box */}
      {(finding.aiSummary || finding.aiClassification) && (
        <div className="card card-tight" style={{ background: 'var(--surface-2)', marginBottom: 10 }}>
          <div className="row" style={{ marginBottom: 5 }}>
            <ClassificationBadge
              value={finding.aiClassification}
              confidence={finding.aiConfidence}
              ai
            />
            <span className="faint">Suggestion only. You decide.</span>
          </div>
          {finding.aiSummary && <div>{finding.aiSummary}</div>}
          {finding.aiSuspectedCause && (
            <div className="faint" style={{ marginTop: 4 }}>
              Suspected cause: {finding.aiSuspectedCause}
            </div>
          )}
          {evidence?.evidenceUsed?.length ? (
            <details className="collapse" style={{ marginTop: 4 }}>
              <summary>Evidence the AI used</summary>
              <ul style={{ margin: '4px 0 0 16px' }} className="mono">
                {evidence.evidenceUsed.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </details>
          ) : null}
          {evidence?.recommendedNextStep && (
            <div className="faint" style={{ marginTop: 4 }}>
              Next step: {evidence.recommendedNextStep}
            </div>
          )}
        </div>
      )}

      {finding.humanClassification && (
        <div className="row" style={{ marginBottom: 10 }}>
          <span className="faint">Human verdict:</span>
          <ClassificationBadge value={finding.humanClassification} />
          {finding.severity && <span className="pill">{finding.severity.replace('_', ' ')}</span>}
          {finding.note && <span className="faint">— {finding.note}</span>}
        </div>
      )}

      {/* -------------------------------------------------- the QA decision */}
      <div className="row">
        {open && !showTriage && canWrite && (
          <button className="btn btn-sm btn-primary" onClick={() => setShowTriage(true)}>
            Triage this
          </button>
        )}
        {['CONFIRMED', 'REOPENED'].includes(finding.status) && !finding.ticket && canWrite && (
          <button className="btn btn-sm" onClick={() => setShowTicket((v) => !v)}>
            + Create ticket
          </button>
        )}
        {finding.ticket && (
          <a className="btn btn-sm" href={`/tickets/${finding.ticket.id}`}>
            Open {finding.ticket.key}
          </a>
        )}
        {finding.status === 'CONFIRMED' && canWrite && (
          <button
            className="btn btn-sm btn-success"
            disabled={busy !== null}
            onClick={() => act('close', () => closeFinding(finding.id, note || undefined))}
          >
            {busy === 'close' ? <span className="spinner" /> : null} Close
          </button>
        )}
        {['CLOSED', 'REJECTED'].includes(finding.status) && canWrite && (
          <button
            className="btn btn-sm btn-danger"
            disabled={busy !== null}
            onClick={() =>
              act('reopen', () =>
                reopenFinding(finding.id, window.prompt('Why are you reopening this?') ?? undefined),
              )
            }
          >
            {busy === 'reopen' ? <span className="spinner" /> : null} Reopen
          </button>
        )}
        {finding.status === 'REOPENED' && canWrite && (
          <button
            className="btn btn-sm"
            disabled={busy !== null}
            onClick={() => act('close', () => closeFinding(finding.id, note || undefined))}
          >
            Close again
          </button>
        )}
      </div>

      {showTriage && (
        <div className="card card-tight" style={{ marginTop: 10 }}>
          <div className="grid-2">
            <label className="field" style={{ marginBottom: 0 }}>
              <span className="field-label">Classification</span>
              <select value={classification} onChange={(e) => setClassification(e.target.value)}>
                {CLASSIFICATIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field" style={{ marginBottom: 0 }}>
              <span className="field-label">Severity (if confirming)</span>
              <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
                {SEVERITIES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid-2" style={{ marginTop: 10 }}>
            <label className="field" style={{ marginBottom: 0 }}>
              <span className="field-label">Priority &mdash; how soon</span>
              <select value={priority} onChange={(e) => setPriority(e.target.value)}>
                <option value="P0">P0 &mdash; blocks release</option>
                <option value="P1">P1 &mdash; this sprint</option>
                <option value="P2">P2 &mdash; normal</option>
                <option value="P3">P3 &mdash; whenever</option>
              </select>
            </label>
            <label className="field" style={{ marginBottom: 0 }}>
              <span className="field-label">Module / feature</span>
              <input
                type="text"
                placeholder="Login page"
                value={module}
                onChange={(e) => setModule(e.target.value)}
              />
            </label>
          </div>

          <label className="field" style={{ marginTop: 10, marginBottom: 0 }}>
            <span className="field-label">Build / version under test</span>
            <input
              type="text"
              placeholder="staging-2026-08-19"
              value={build}
              onChange={(e) => setBuild(e.target.value)}
            />
          </label>

          <label className="field" style={{ marginTop: 10, marginBottom: 0 }}>
            <span className="field-label">Note</span>
            <input
              type="text"
              placeholder="What did you check, and what did you conclude?"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className="row" style={{ marginTop: 10 }}>
            <button
              className="btn btn-sm btn-primary"
              disabled={busy !== null}
              onClick={() =>
                act('confirm', () =>
                  triageFinding(finding.id, {
                    decision: 'CONFIRM',
                    classification,
                    severity,
                    priority,
                    module: module.trim() || undefined,
                    build: build.trim() || undefined,
                    note: note || undefined,
                    actor: user?.email,
                  }),
                )
              }
            >
              {busy === 'confirm' ? <span className="spinner" /> : null} Confirm as defect
            </button>
            <button
              className="btn btn-sm"
              disabled={busy !== null}
              onClick={() =>
                act('reject', () =>
                  triageFinding(finding.id, {
                    decision: 'REJECT',
                    classification,
                    note: note || undefined,
                    actor: user?.email,
                  }),
                )
              }
            >
              Not a defect
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setShowTriage(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {showTicket && (
        <CreateTicketDialog
          finding={finding}
          onCreated={() => {
            setShowTicket(false);
            onChanged();
          }}
          onCancel={() => setShowTicket(false)}
        />
      )}

      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
        <div className="faint" style={{ marginBottom: 6 }}>
          BUG REPORT
        </div>
        <BugReportActions finding={finding} />
      </div>

      {showEvidence && (
        <div style={{ marginTop: 12 }}>
          <ResultEvidence resultId={finding.resultId} />
        </div>
      )}

      {/* ------------------------------------------------------ audit trail */}
      <details className="collapse" style={{ marginTop: 10 }}>
        <summary>History ({finding.events.length})</summary>
        <table className="data">
          <tbody>
            {finding.events.map((e) => (
              <tr key={e.id}>
                <td className="faint" style={{ whiteSpace: 'nowrap' }}>
                  {new Date(e.createdAt).toLocaleString()}
                </td>
                <td>
                  <span className="pill">{e.actor}</span>
                </td>
                <td>
                  {e.fromStatus && e.fromStatus !== e.toStatus
                    ? `${e.fromStatus} → ${e.toStatus}`
                    : e.toStatus}
                </td>
                <td>{e.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 8 }}>
          <input
            type="text"
            placeholder="Add a comment"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            className="btn btn-sm"
            disabled={busy !== null || !note.trim()}
            onClick={() => act('comment', () => commentOnFinding(finding.id, note))}
          >
            Comment
          </button>
        </div>
      </details>
    </div>
  );
}
