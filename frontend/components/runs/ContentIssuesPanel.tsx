'use client';

import { useState } from 'react';
import { promoteContentIssue, reviewContentIssue } from '@/lib/api';
import type { ContentIssue, ContentIssueKind } from '@/lib/types';

/**
 * The wording review list.
 *
 * This panel is deliberately NOT part of the pass/fail story. A spell-check over
 * real product copy will always flag some brand names and jargon, so treating
 * these as failures would poison the one number that matters - that the platform
 * has never filed a false bug. They are suggestions, and dismissing one is a
 * first-class action rather than an afterthought.
 */

const KIND_LABEL: Record<ContentIssueKind, string> = {
  TYPO: 'Typo',
  GRAMMAR: 'Grammar',
  LABEL: 'Wrong label',
  CASING: 'Capitalisation',
  PLACEHOLDER: 'Placeholder text',
  INCONSISTENT: 'Inconsistent wording',
};

export function ContentIssuesPanel({
  issues,
  showPage,
  onPromoted,
}: {
  issues: ContentIssue[];
  /**
   * Label each row with the page it came from.
   *
   * On a whole-app run this is not decoration: "Contnue" is unactionable until
   * you know which of twelve screens it is on. Off for a single-page run, where
   * repeating the same path on every row would be noise.
   */
  showPage?: boolean;
  /** Refresh the run so the new bug shows up under Failures. */
  onPromoted?: () => void;
}) {
  // Optimistic local state: dismissing is the most common action here and
  // waiting for a round trip to grey out a row feels broken.
  const [local, setLocal] = useState<Record<string, ContentIssue['status']>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);
  const [raised, setRaised] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const statusOf = (i: ContentIssue) => local[i.id] ?? i.status;

  const set = async (i: ContentIssue, status: ContentIssue['status']) => {
    setBusy(i.id);
    const previous = statusOf(i);
    setLocal((m) => ({ ...m, [i.id]: status }));
    try {
      await reviewContentIssue(i.id, status);
    } catch {
      setLocal((m) => ({ ...m, [i.id]: previous }));
    } finally {
      setBusy(null);
    }
  };

  const raise = async (i: ContentIssue) => {
    setBusy(i.id);
    setError(null);
    try {
      const res = await promoteContentIssue(i.id);
      setRaised((m) => ({ ...m, [i.id]: res.bugKey ?? 'BUG' }));
      setLocal((m) => ({ ...m, [i.id]: 'ACCEPTED' }));
      onPromoted?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const open = issues.filter((i) => statusOf(i) !== 'DISMISSED');
  const dismissed = issues.filter((i) => statusOf(i) === 'DISMISSED');
  const visible = showDismissed ? [...open, ...dismissed] : open;

  if (!issues.length) {
    return (
      <div className="empty">
        <strong>No wording problems found.</strong>
        <div className="faint">
          The AI read the page text and did not spot typos, grammar issues or leftover placeholder
          content.
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="spread" style={{ marginBottom: 10 }}>
        <div>
          <strong>
            {open.length} wording {open.length === 1 ? 'suggestion' : 'suggestions'}
          </strong>
          <div className="faint">
            The AI never turns these into bugs by itself &mdash; you decide. Raise the real ones,
            dismiss anything that is a brand name or industry term.
          </div>
        </div>
        {dismissed.length > 0 && (
          <button className="btn btn-sm" onClick={() => setShowDismissed((v) => !v)}>
            {showDismissed ? 'Hide' : 'Show'} {dismissed.length} dismissed
          </button>
        )}
      </div>

      {error && (
        <div className="banner banner-error" style={{ marginBottom: 8 }}>
          {error}
        </div>
      )}

      <div className="stack">
        {visible.map((i) => {
          const status = statusOf(i);
          const isDismissed = status === 'DISMISSED';
          return (
            <div key={i.id} className="card card-tight" style={{ opacity: isDismissed ? 0.5 : 1 }}>
              <div className="spread">
                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ marginBottom: 4 }}>
                    <span className="badge badge-neutral">{KIND_LABEL[i.kind] ?? i.kind}</span>
                    {i.whereSeen && <span className="faint">in {i.whereSeen}</span>}
                    {/* Which screen this is on. Without it a typo found on a
                        twelve-page run cannot be acted on at all. */}
                    {showPage && i.pageUrl && (
                      <span className="pill mono" title={i.pageUrl}>
                        {pathOf(i.pageUrl)}
                      </span>
                    )}
                    {i.confidence < 0.8 && (
                      <span className="faint" title="The AI was unsure - check it is not a name">
                        low confidence
                      </span>
                    )}
                    {status === 'ACCEPTED' && <span className="badge badge-fail">Confirmed</span>}
                  </div>

                  {/* On the page vs suggested. Showing both is the whole value:
                      the reviewer decides in one glance without opening the site. */}
                  <div className="mono" style={{ wordBreak: 'break-word' }}>
                    {i.text}
                  </div>
                  {i.suggestion && (
                    <div className="mono" style={{ color: 'var(--pass)', wordBreak: 'break-word' }}>
                      &rarr; {i.suggestion}
                    </div>
                  )}
                  {i.reason && (
                    <div className="faint" style={{ marginTop: 3 }}>
                      {i.reason}
                    </div>
                  )}
                </div>

                <div className="row" style={{ flexShrink: 0 }}>
                  {isDismissed ? (
                    <button
                      className="btn btn-sm"
                      disabled={busy === i.id}
                      onClick={() => set(i, 'NEW')}
                    >
                      Restore
                    </button>
                  ) : (
                    <>
                      {raised[i.id] ? (
                        <span className="badge badge-fail">{raised[i.id]} raised</span>
                      ) : (
                        <button
                          className="btn btn-sm btn-primary"
                          disabled={busy === i.id}
                          onClick={() => raise(i)}
                          title="Create a real bug with a BUG id, PDF and ticket"
                        >
                          {busy === i.id ? <span className="spinner" /> : null} Raise bug
                        </button>
                      )}
                      <button
                        className="btn btn-sm"
                        disabled={busy === i.id}
                        onClick={() => set(i, 'DISMISSED')}
                        title="Brand name, jargon, or not a problem"
                      >
                        Not an issue
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** "https://app.example.com/settings?tab=billing" -> "/settings?tab=billing" */
function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}` || '/';
  } catch {
    return url;
  }
}
