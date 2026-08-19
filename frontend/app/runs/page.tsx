'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { RunStatusBadge } from '../../components/StatusBadge';
import { listRuns } from '../../lib/api';
import type { RunListItem } from '../../lib/types';

export default function RunsPage() {
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const data = await listRuns();
        if (!cancelled) {
          setRuns(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    // Keeps in-progress runs updating without a manual refresh.
    const timer = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="stack">
      <div className="spread">
        <div>
          <h1>Test runs</h1>
          <span className="faint">Every run, newest first.</span>
        </div>
        <Link href="/" className="btn btn-primary">
          + New run
        </Link>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      {loading && runs.length === 0 && (
        <div className="empty">
          <span className="spinner" /> Loading runs
        </div>
      )}

      {!loading && runs.length === 0 && !error && (
        <div className="card empty">
          <div className="empty-icon">▶</div>
          <div>No runs yet.</div>
          <div className="faint" style={{ marginTop: 6 }}>
            Start one from the New run screen.
          </div>
        </div>
      )}

      <div className="stack-sm">
        {runs.map((run) => (
          <Link key={run.id} href={`/runs/${run.id}`} className="card card-tight card-link">
            <div className="spread">
              <div style={{ minWidth: 0 }}>
                <strong>{run.name}</strong>
                <div className="faint mono truncate" style={{ maxWidth: 520 }}>
                  {run.targetUrl}
                </div>
              </div>
              <RunStatusBadge status={run.status} />
            </div>
            <div className="row faint" style={{ marginTop: 7 }}>
              <span className="pill">{run._count.testCases} cases</span>
              <span className="pill">{run._count.findings} findings</span>
              <span>{new Date(run.createdAt).toLocaleString()}</span>
            </div>
            {run.statusMessage && (
              <div className="faint truncate" style={{ marginTop: 5 }}>
                {run.statusMessage}
              </div>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
