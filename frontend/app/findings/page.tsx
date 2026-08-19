'use client';

import { useCallback, useEffect, useState } from 'react';
import { FindingCard } from '../../components/FindingCard';
import { getFindingStats, listFindings } from '../../lib/api';
import type { Finding, FindingStatus } from '../../lib/types';

/**
 * THE TRIAGE INBOX.
 *
 * Every failure across every run, grouped by where it is in the QA workflow.
 * NEW and REOPENED are the two queues that need a human today.
 */

const QUEUES: Array<{ id: FindingStatus | 'ALL'; label: string; hint: string }> = [
  { id: 'NEW', label: 'To review', hint: 'Failures nobody has decided on yet' },
  { id: 'REOPENED', label: 'Came back', hint: 'Was closed, then failed again' },
  { id: 'CONFIRMED', label: 'Real bugs', hint: 'Confirmed defects, waiting for a fix' },
  { id: 'REJECTED', label: 'Not a bug', hint: 'Test, environment or data problems' },
  { id: 'CLOSED', label: 'Done', hint: 'Finished' },
  { id: 'ALL', label: 'All', hint: '' },
];

export default function FindingsPage() {
  const [queue, setQueue] = useState<FindingStatus | 'ALL'>('NEW');
  const [findings, setFindings] = useState<Finding[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [list, counts] = await Promise.all([
        listFindings(queue === 'ALL' ? undefined : { status: queue }),
        getFindingStats(),
      ]);
      setFindings(list);
      setStats(counts);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [queue]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const active = QUEUES.find((q) => q.id === queue);

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div>
            <h1>Failures to review</h1>
            <span className="faint">
              A failed test is not a bug yet. You decide — and only then does it get a BUG number.
            </span>
          </div>
          {loading && <span className="spinner" />}
        </div>

        <div className="tabs" style={{ marginBottom: 0 }}>
          {QUEUES.map((q) => (
            <button
              key={q.id}
              type="button"
              className={`tab ${queue === q.id ? 'tab-active' : ''}`}
              onClick={() => setQueue(q.id)}
            >
              {q.label}
              <span className="tab-count">
                {q.id === 'ALL'
                  ? Object.values(stats).reduce((a, b) => a + b, 0)
                  : (stats[q.id] ?? 0)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {active?.hint && <div className="faint">{active.hint}</div>}

      {error && <div className="banner banner-error">{error}</div>}

      {!error && findings.length === 0 && !loading && (
        <div className="empty">Nothing in this queue.</div>
      )}

      <div className="stack">
        {findings.map((f) => (
          <FindingCard key={f.id} finding={f} onChanged={load} />
        ))}
      </div>
    </div>
  );
}
