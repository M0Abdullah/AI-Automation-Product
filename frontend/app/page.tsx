'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { RunForm } from '../components/RunForm';
import { RunStatusBadge } from '../components/StatusBadge';
import { listRuns } from '../lib/api';
import type { RunListItem } from '../lib/types';

const STEPS = [
  {
    n: 1,
    title: 'Chrome reads the page',
    body: 'The AI cannot see a website, so the browser looks first and lists every field, button and link it finds.',
  },
  {
    n: 2,
    title: 'The AI writes test cases',
    body: 'Structured JSON, using only the elements that were actually found — never invented ones.',
  },
  {
    n: 3,
    title: 'The backend validates every step',
    body: 'Unknown actions, off-site navigation and destructive clicks are rejected before anything runs.',
  },
  {
    n: 4,
    title: 'You approve or edit',
    body: 'Nothing executes without a human decision. Your edits go through the same checks.',
  },
  {
    n: 5,
    title: 'Chrome runs them and judges',
    body: 'Deterministic assertions decide PASS or FAIL. The AI has no vote here.',
  },
  {
    n: 6,
    title: 'Failures become bug reports',
    body: 'Re-run once to check reproducibility, AI suggests a cause, you confirm — then ticket it and export the PDF.',
  },
];

export default function HomePage() {
  const [runs, setRuns] = useState<RunListItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      listRuns()
        .then((d) => !cancelled && setRuns(d.slice(0, 5)))
        .catch(() => undefined);

    void load();
    const timer = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="grid-sidebar">
      <RunForm />

      <div className="stack">
        <div className="card">
          <div className="card-head">
            <h2>How it works</h2>
          </div>
          <div className="stack-sm">
            {STEPS.map((s) => (
              <div key={s.n} className="row" style={{ alignItems: 'flex-start', gap: 11 }}>
                <span
                  className="avatar"
                  style={{ width: 22, height: 22, fontSize: 11, borderRadius: 6 }}
                >
                  {s.n}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 620, fontSize: 13.5 }}>{s.title}</div>
                  <div className="faint">{s.body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Recent runs</h2>
            <Link href="/runs" className="btn btn-sm btn-ghost">
              View all
            </Link>
          </div>

          {runs.length === 0 ? (
            <div className="empty" style={{ padding: '24px 12px' }}>
              <div className="faint">No runs yet. Start one on the left.</div>
            </div>
          ) : (
            <div className="stack-sm">
              {runs.map((run) => (
                <Link
                  key={run.id}
                  href={`/runs/${run.id}`}
                  className="card card-tight card-link"
                  style={{ boxShadow: 'none' }}
                >
                  <div className="spread">
                    <span className="truncate" style={{ fontWeight: 600, maxWidth: 200 }}>
                      {run.name}
                    </span>
                    <RunStatusBadge status={run.status} />
                  </div>
                  <div className="faint mono truncate" style={{ marginTop: 3 }}>
                    {run.targetUrl}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
