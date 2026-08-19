'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../../components/AuthProvider';
import { ScreenshotPanel } from '../../../components/ScreenshotPanel';
import { PriorityBadge, TicketStatusBadge } from '../../../components/StatusBadge';
import {
  ApiError,
  commentOnTicket,
  getTeam,
  getTicket,
  linkExternalTicket,
  retestTicket,
  updateTicket,
} from '../../../lib/api';
import {
  SEVERITY_LABEL,
  TICKET_STATUS_LABEL,
  TICKET_TRANSITIONS,
  type TeamMember,
  type Ticket,
  type TicketStatus,
} from '../../../lib/types';

/**
 * TICKET DETAIL — the developer-facing view of a confirmed bug.
 *
 * The description is the generated bug report, so everything needed to fix the
 * problem is on this one page. The Retest button reruns the linked test, which
 * is what makes "Ready for retest" an actual handoff rather than a label.
 */
export default function TicketPage() {
  const params = useParams<{ id: string }>();
  const { canWrite } = useAuth();

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [retestMsg, setRetestMsg] = useState<string | null>(null);
  const [showLink, setShowLink] = useState(false);
  const [extKey, setExtKey] = useState('');
  const [extUrl, setExtUrl] = useState('');

  const load = useCallback(async () => {
    try {
      setTicket(await getTicket(params.id));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [params.id]);

  useEffect(() => {
    void load();
    getTeam()
      .then(setTeam)
      .catch(() => undefined);
  }, [load]);

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

  const onRetest = async () => {
    setBusy('retest');
    setActionError(null);
    setRetestMsg(null);
    try {
      const res = await retestTicket(params.id);
      setRetestMsg(
        res.passed
          ? 'Retest PASSED. It looks fixed — mark it Resolved if you agree.'
          : 'Retest still FAILS. The fix is not in place yet.',
      );
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
        <Link href="/tickets" className="btn btn-sm">
          Back to tickets
        </Link>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="empty">
        <span className="spinner" /> Loading ticket
      </div>
    );
  }

  const nextStates = TICKET_TRANSITIONS[ticket.status] ?? [];

  return (
    <div className="stack">
      {/* ------------------------------------------------------------ header */}
      <div className="card">
        <div className="spread">
          <div style={{ minWidth: 0 }}>
            <div className="row">
              <span className="pill pill-key">{ticket.key}</span>
              <TicketStatusBadge status={ticket.status} />
              <PriorityBadge priority={ticket.priority} />
              {ticket.finding?.bugKey && (
                <Link href="/findings" className="pill pill-key">
                  {ticket.finding.bugKey}
                </Link>
              )}
            </div>
            <h1 style={{ marginTop: 8 }}>{ticket.title}</h1>
            <div className="row faint" style={{ marginTop: 5 }}>
              <span>Reported by {ticket.reporter?.name ?? 'unknown'}</span>
              <span>· {new Date(ticket.createdAt).toLocaleString()}</span>
              {ticket.finding && <span>· seen {ticket.finding.occurrences}×</span>}
            </div>
          </div>

          <div className="row">
            <button className="btn" onClick={onRetest} disabled={busy !== null}>
              {busy === 'retest' ? <span className="spinner" /> : '↻'} Retest
            </button>
            {ticket.externalUrl ? (
              <a className="btn btn-primary" href={ticket.externalUrl} target="_blank" rel="noreferrer">
                Open {ticket.externalKey} ↗
              </a>
            ) : (
              canWrite && (
                <button className="btn" onClick={() => setShowLink((v) => !v)}>
                  Link to Jira
                </button>
              )
            )}
          </div>
        </div>

        {actionError && (
          <div className="banner banner-error" style={{ marginTop: 12 }}>
            {actionError}
          </div>
        )}
        {retestMsg && (
          <div
            className={`banner ${retestMsg.includes('PASSED') ? 'banner-success' : 'banner-warn'}`}
            style={{ marginTop: 12 }}
          >
            {retestMsg}
          </div>
        )}

        {/* ------------------------------------------------ link to tracker */}
        {showLink && !ticket.externalUrl && (
          <div className="card card-tight" style={{ marginTop: 12, background: 'var(--surface-2)' }}>
            <div className="field-hint">
              Create the issue in Jira, then paste its key and URL here. The button above becomes a
              link straight to it.
            </div>
            <div className="grid-2">
              <label className="field" style={{ marginBottom: 0 }}>
                <span className="field-label">Issue key</span>
                <input
                  type="text"
                  placeholder="QA-142"
                  value={extKey}
                  onChange={(e) => setExtKey(e.target.value)}
                />
              </label>
              <label className="field" style={{ marginBottom: 0 }}>
                <span className="field-label">Issue URL</span>
                <input
                  type="url"
                  placeholder="https://yourteam.atlassian.net/browse/QA-142"
                  value={extUrl}
                  onChange={(e) => setExtUrl(e.target.value)}
                />
              </label>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button
                className="btn btn-sm btn-primary"
                disabled={busy !== null || !extKey.trim() || !extUrl.trim()}
                onClick={() =>
                  act('link', async () => {
                    await linkExternalTicket(ticket.id, {
                      externalKey: extKey.trim(),
                      externalUrl: extUrl.trim(),
                    });
                    setShowLink(false);
                  })
                }
              >
                Save link
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => setShowLink(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="grid-sidebar">
        {/* ----------------------------------------------------- description */}
        <div className="stack">
          {ticket.finding?.result?.screenshotPath && (
            <div className="card">
              <div className="card-head">
                <h2>What it looked like</h2>
                <span className="faint">
                  {ticket.finding.result.browserName} · attempt{' '}
                  {ticket.finding.result.attempt}
                </span>
              </div>
              <ScreenshotPanel
                screenshotPath={ticket.finding.result.screenshotPath}
                tracePath={ticket.finding.result.tracePath}
                caption={`Captured when the test failed · ${ticket.finding.result.viewport ?? ''}`}
              />
            </div>
          )}

          <div className="card">
            <div className="card-head">
              <h2>Bug report</h2>
              <span className="faint">Generated from the run evidence</span>
            </div>
            <div className="logbox" style={{ maxHeight: 520 }}>
              {ticket.description}
            </div>
          </div>

          {/* ------------------------------------------------------ comments */}
          <div className="card">
            <div className="card-head">
              <h2>Comments</h2>
              <span className="faint">{ticket.comments?.length ?? 0}</span>
            </div>

            {(ticket.comments ?? []).length === 0 && (
              <div className="faint" style={{ marginBottom: 12 }}>
                No comments yet.
              </div>
            )}

            {(ticket.comments ?? []).map((c) => (
              <div className="comment" key={c.id}>
                <div className="comment-head">
                  <span className="comment-author">{c.author?.name ?? 'Unknown'}</span>
                  <span className="faint">{new Date(c.createdAt).toLocaleString()}</span>
                </div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>
              </div>
            ))}

            <div className="row" style={{ marginTop: 8 }}>
              <input
                type="text"
                placeholder="Add a comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
              <button
                className="btn btn-sm"
                disabled={busy !== null || !comment.trim()}
                onClick={() =>
                  act('comment', async () => {
                    await commentOnTicket(ticket.id, comment.trim());
                    setComment('');
                  })
                }
              >
                Comment
              </button>
            </div>
          </div>
        </div>

        {/* ---------------------------------------------------------- sidebar */}
        <div className="stack">
          <div className="card">
            <div className="card-head">
              <h2>Details</h2>
            </div>
            <dl className="detail-grid">
              <dt>Status</dt>
              <dd>
                <TicketStatusBadge status={ticket.status} />
              </dd>
              <dt>Priority</dt>
              <dd>{ticket.priority}</dd>
              <dt>Severity</dt>
              <dd>{ticket.severity ? (SEVERITY_LABEL[ticket.severity] ?? ticket.severity) : '—'}</dd>
              <dt>Module</dt>
              <dd>{ticket.module ?? '—'}</dd>
              <dt>Build</dt>
              <dd>{ticket.build ?? '—'}</dd>
              <dt>Assignee</dt>
              <dd>{ticket.assignee?.name ?? 'Unassigned'}</dd>
              <dt>Reporter</dt>
              <dd>{ticket.reporter?.name ?? '—'}</dd>
              <dt>Labels</dt>
              <dd>
                {ticket.labels
                  ? ticket.labels.split(',').map((l) => (
                      <span className="pill" key={l} style={{ marginRight: 4 }}>
                        {l.trim()}
                      </span>
                    ))
                  : '—'}
              </dd>
              <dt>Classification</dt>
              <dd>
                {ticket.finding?.humanClassification ?? ticket.finding?.aiClassification ?? '—'}
              </dd>
            </dl>
          </div>

          {canWrite && (
            <div className="card">
              <div className="card-head">
                <h2>Move ticket</h2>
              </div>
              {nextStates.length === 0 ? (
                <div className="faint">No moves available from this state.</div>
              ) : (
                <div className="stack-sm">
                  {nextStates.map((s) => (
                    <button
                      key={s}
                      className={`btn btn-sm btn-block ${s === 'RESOLVED' ? 'btn-success' : ''}`}
                      disabled={busy !== null}
                      onClick={() => act(`move-${s}`, () => updateTicket(ticket.id, { status: s }))}
                    >
                      {busy === `move-${s}` ? <span className="spinner" /> : null} Move to{' '}
                      {TICKET_STATUS_LABEL[s as TicketStatus]}
                    </button>
                  ))}
                </div>
              )}

              <label className="field" style={{ marginTop: 14, marginBottom: 0 }}>
                <span className="field-label">Reassign</span>
                <select
                  value={ticket.assignee?.id ?? ''}
                  onChange={(e) =>
                    act('assign', () => updateTicket(ticket.id, { assigneeId: e.target.value }))
                  }
                >
                  <option value="">Unassigned</option>
                  {team.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} — {m.role}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <div className="card">
            <div className="card-head">
              <h2>History</h2>
            </div>
            <div className="timeline">
              {(ticket.events ?? []).map((e) => (
                <div className="timeline-item" key={e.id}>
                  <div>
                    <strong>{e.actor}</strong>{' '}
                    {e.field === 'comment'
                      ? 'commented'
                      : e.field === 'created'
                        ? 'created this ticket'
                        : e.field === 'retest'
                          ? `ran a retest — ${e.toValue}`
                          : `changed ${e.field}${e.fromValue ? ` from ${e.fromValue}` : ''} to ${e.toValue}`}
                  </div>
                  <div className="faint">{new Date(e.createdAt).toLocaleString()}</div>
                  {e.note && <div className="faint">{e.note}</div>}
                </div>
              ))}
            </div>
          </div>

          {ticket.finding && (
            <Link href={`/runs/${ticket.finding.runId}`} className="btn btn-block">
              View the test run
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
