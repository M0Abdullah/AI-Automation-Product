'use client';

import { useState } from 'react';
import { getRunPage } from '../lib/api';
import type { RunPage, RunPageDetail, RunPageStatus } from '../lib/types';
import { PageScanPanel } from './PageScanPanel';

/**
 * EVERY PAGE THE RUN COVERS, and what happened to each.
 *
 * This panel exists because of the one honest problem with testing a whole app:
 * a run can look green while a quarter of the app was never read. Twelve pages
 * discovered, nine planned, two unreachable and one over the case budget is a
 * completely different result from "12 pages tested", and the difference is
 * invisible unless it is stated per page.
 *
 * So the failures are shown FIRST and counted in the header, rather than being
 * buried under the pages that worked.
 *
 * Snapshots are fetched on demand. A twelve-page run holds several megabytes of
 * them, and the run payload is polled every couple of seconds while the run is
 * in progress - putting them in that response would make the page crawl.
 */

const STATUS_META: Record<RunPageStatus, { label: string; badge: string; hint: string }> = {
  DISCOVERED: {
    label: 'Queued',
    badge: 'badge-neutral',
    hint: 'Found by the crawler, not read yet.',
  },
  SCANNING: { label: 'Reading', badge: 'badge-info', hint: 'Chrome is on this page now.' },
  SCANNED: {
    label: 'Read',
    badge: 'badge-info',
    hint: 'The page was read; its tests are being written.',
  },
  PLANNED: { label: 'Tests written', badge: 'badge-pass', hint: '' },
  SCAN_FAILED: {
    label: 'Could not read',
    badge: 'badge-fail',
    hint: 'No tests were written for this page.',
  },
  PLAN_FAILED: {
    label: 'No tests',
    badge: 'badge-fail',
    hint: 'The page was read, but nothing testable came out of it.',
  },
  SKIPPED: { label: 'Skipped', badge: 'badge-warn', hint: '' },
};

const FAILED: RunPageStatus[] = ['SCAN_FAILED', 'PLAN_FAILED'];

export function RunPagesPanel({
  runId,
  pages,
  /** Which links the crawler deliberately did not follow, and why. */
  skipped,
}: {
  runId: string;
  pages: RunPage[];
  skipped?: Array<{ id: string; subject: string; reason: string }>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, RunPageDetail>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);

  const toggle = async (page: RunPage) => {
    if (openId === page.id) {
      setOpenId(null);
      return;
    }
    setOpenId(page.id);
    if (detail[page.id]) return;

    setLoading(page.id);
    setError(null);
    try {
      const d = await getRunPage(runId, page.id);
      setDetail((m) => ({ ...m, [page.id]: d }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(null);
    }
  };

  const failed = pages.filter((p) => FAILED.includes(p.status));
  const rest = pages.filter((p) => !FAILED.includes(p.status));
  // Unreadable pages lead. A run that reports itself as healthy while three
  // screens were never opened is the one failure mode of whole-app testing, so
  // it is put where nobody can miss it.
  const ordered = [...failed, ...rest];

  return (
    <>
      <div className="spread" style={{ marginBottom: 10 }}>
        <div>
          <strong>
            {pages.length} {pages.length === 1 ? 'page' : 'pages'} in this run
          </strong>
          <div className="faint">
            {failed.length > 0
              ? `${failed.length} could not be tested — no tests exist for ${
                  failed.length === 1 ? 'it' : 'them'
                }, so nothing here says whether ${
                  failed.length === 1 ? 'it works' : 'they work'
                }.`
              : 'Every page was read and planned.'}
          </div>
        </div>
        {skipped && skipped.length > 0 && (
          <button className="btn btn-sm" onClick={() => setShowSkipped((v) => !v)}>
            {showSkipped ? 'Hide' : 'Show'} {skipped.length} link
            {skipped.length === 1 ? '' : 's'} not followed
          </button>
        )}
      </div>

      {error && (
        <div className="banner banner-error" style={{ marginBottom: 8 }}>
          {error}
        </div>
      )}

      {showSkipped && skipped && (
        <div className="card card-tight" style={{ marginBottom: 10, background: 'var(--surface-2)' }}>
          <div className="faint" style={{ marginBottom: 6 }}>
            Links found and deliberately not followed. Nothing is dropped silently — this is
            the answer to &ldquo;why is that page missing from my run&rdquo;.
          </div>
          <table className="data">
            <tbody>
              {skipped.map((sk) => (
                <tr key={sk.id}>
                  <td className="mono" style={{ wordBreak: 'break-all' }}>
                    {sk.subject}
                  </td>
                  <td className="faint">{sk.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="stack-sm">
        {ordered.map((page) => {
          const meta = STATUS_META[page.status];
          const isOpen = openId === page.id;
          const d = detail[page.id];

          return (
            <div key={page.id} className="card card-tight">
              <div className="spread">
                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ marginBottom: 3, flexWrap: 'wrap' }}>
                    <span className={`badge ${meta.badge}`}>{meta.label}</span>
                    <strong className="mono" style={{ wordBreak: 'break-all' }}>
                      {page.path}
                    </strong>
                    {page.isEntry && (
                      <span className="pill" title="The URL you submitted">
                        entry
                      </span>
                    )}
                    {page.depth > 0 && (
                      <span className="pill faint" title="Clicks from the entry page">
                        {page.depth} deep
                      </span>
                    )}
                  </div>

                  {page.title && <div>{page.title}</div>}

                  <div className="row faint" style={{ gap: 10, flexWrap: 'wrap', marginTop: 3 }}>
                    {page.status === 'PLANNED' && (
                      <span>
                        {page._count?.testCases ?? 0} test
                        {(page._count?.testCases ?? 0) === 1 ? '' : 's'}
                      </span>
                    )}
                    {page.elementCount > 0 && <span>{page.elementCount} elements</span>}
                    {(page._count?.contentIssues ?? 0) > 0 && (
                      <span>{page._count?.contentIssues} wording</span>
                    )}
                    {(page._count?.designIssues ?? 0) > 0 && (
                      <span>{page._count?.designIssues} design</span>
                    )}
                  </div>

                  {/* The reason, in the user's words, whenever there is one. */}
                  {page.statusMessage && (
                    <div
                      className={FAILED.includes(page.status) ? 'banner banner-error' : 'faint'}
                      style={{ marginTop: 6, display: 'block' }}
                    >
                      {page.statusMessage}
                      {meta.hint && FAILED.includes(page.status) && (
                        <div style={{ fontWeight: 400, marginTop: 3 }}>{meta.hint}</div>
                      )}
                    </div>
                  )}

                  {/* Why this page is in the run at all. */}
                  {page.discoveredFrom && (
                    <div className="faint mono" style={{ marginTop: 4, wordBreak: 'break-all' }}>
                      linked from {page.discoveredFrom}
                    </div>
                  )}
                </div>

                <div className="row" style={{ flexShrink: 0 }}>
                  <a
                    href={page.url}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-sm btn-ghost"
                  >
                    Open
                  </a>
                  {page.elementCount > 0 && (
                    <button className="btn btn-sm" onClick={() => void toggle(page)}>
                      {loading === page.id ? <span className="spinner" /> : null}
                      {isOpen ? 'Hide' : 'What the AI saw'}
                    </button>
                  )}
                </div>
              </div>

              {isOpen && d?.pageSnapshot && (
                <div style={{ marginTop: 12 }}>
                  <PageScanPanel snapshot={d.pageSnapshot} />
                </div>
              )}
              {isOpen && d && !d.pageSnapshot && (
                <div className="faint" style={{ marginTop: 10 }}>
                  No snapshot was stored for this page.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
