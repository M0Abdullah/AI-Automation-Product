'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { PriorityBadge, TicketStatusBadge } from '../../components/StatusBadge';
import { getTicketStats, listTickets } from '../../lib/api';
import { SEVERITY_LABEL, TICKET_STATUS_LABEL, type Ticket, type TicketStatus } from '../../lib/types';

/**
 * THE TICKET BOARD.
 *
 * Columns follow the lifecycle left to right, so the eye lands on the two that
 * need action: OPEN (nobody has started) and READY FOR RETEST (waiting on QA).
 */
const COLUMNS: TicketStatus[] = [
  'OPEN',
  'IN_PROGRESS',
  'READY_FOR_RETEST',
  'RESOLVED',
  'REOPENED',
  'CLOSED',
];

export default function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'board' | 'list'>('board');

  const load = useCallback(async () => {
    try {
      const [rows, counts] = await Promise.all([listTickets(), getTicketStats()]);
      setTickets(rows);
      setStats(counts);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, [load]);

  const total = Object.values(stats).reduce((a, b) => a + b, 0);

  return (
    <div className="stack">
      <div className="spread">
        <div>
          <h1>Tickets</h1>
          <span className="faint">
            {total} ticket{total === 1 ? '' : 's'} · created from confirmed bugs
          </span>
        </div>
        <div className="row">
          <button
            className={`btn btn-sm ${view === 'board' ? 'btn-primary' : ''}`}
            onClick={() => setView('board')}
          >
            Board
          </button>
          <button
            className={`btn btn-sm ${view === 'list' ? 'btn-primary' : ''}`}
            onClick={() => setView('list')}
          >
            List
          </button>
          {loading && <span className="spinner" />}
        </div>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      {!loading && total === 0 && (
        <div className="card empty">
          <div className="empty-icon">☰</div>
          <div>No tickets yet.</div>
          <div className="faint" style={{ marginTop: 6 }}>
            Confirm a finding in the <Link href="/findings">triage inbox</Link>, then press
            &ldquo;Create ticket&rdquo;.
          </div>
        </div>
      )}

      {total > 0 && view === 'board' && (
        <div className="kanban">
          {COLUMNS.map((status) => {
            const items = tickets.filter((t) => t.status === status);
            return (
              <div key={status} className="kanban-col">
                <div className="kanban-head">
                  <span>{TICKET_STATUS_LABEL[status]}</span>
                  <span className="nav-count">{items.length}</span>
                </div>
                {items.length === 0 ? (
                  <div className="faint" style={{ padding: '6px 3px' }}>
                    —
                  </div>
                ) : (
                  items.map((t) => <TicketMiniCard key={t.id} ticket={t} />)
                )}
              </div>
            );
          })}
        </div>
      )}

      {total > 0 && view === 'list' && (
        <div className="card card-flush">
          <div className="scroll-x">
            <table className="data">
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Bug</th>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Severity</th>
                  <th>Assignee</th>
                  <th>External</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link href={`/tickets/${t.id}`} className="mono">
                        {t.key}
                      </Link>
                    </td>
                    <td className="mono faint">{t.finding?.bugKey ?? '—'}</td>
                    <td style={{ maxWidth: 320 }}>{t.title}</td>
                    <td>
                      <TicketStatusBadge status={t.status} />
                    </td>
                    <td>
                      <PriorityBadge priority={t.priority} />
                    </td>
                    <td className="faint">
                      {t.severity ? (SEVERITY_LABEL[t.severity] ?? t.severity) : '—'}
                    </td>
                    <td className="faint">{t.assignee?.name ?? 'Unassigned'}</td>
                    <td>
                      {t.externalUrl ? (
                        <a href={t.externalUrl} target="_blank" rel="noreferrer" className="mono">
                          {t.externalKey} ↗
                        </a>
                      ) : (
                        <span className="faint">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function TicketMiniCard({ ticket }: { ticket: Ticket }) {
  return (
    <Link href={`/tickets/${ticket.id}`} className="kanban-card">
      <div className="row" style={{ gap: 6, marginBottom: 5 }}>
        <span className="pill pill-key">{ticket.key}</span>
        <PriorityBadge priority={ticket.priority} />
      </div>
      <div style={{ fontSize: 13, fontWeight: 560, lineHeight: 1.4 }}>{ticket.title}</div>
      <div className="row faint" style={{ marginTop: 6, gap: 6 }}>
        {ticket.assignee ? (
          <span className="pill">{ticket.assignee.name}</span>
        ) : (
          <span className="pill">Unassigned</span>
        )}
        {ticket.externalKey && <span className="pill">{ticket.externalKey}</span>}
      </div>
    </Link>
  );
}
