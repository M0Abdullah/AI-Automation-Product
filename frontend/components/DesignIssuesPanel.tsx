'use client';

import { useState } from 'react';
import { promoteDesignIssue, reviewDesignIssue } from '../lib/api';
import type { DesignIssue } from '../lib/types';

/**
 * Places the live page disagrees with the Figma design.
 *
 * The summary line at the top carries the number of values that MATCHED, not
 * just the number that did not. "7 deviations" on its own reads as a broken
 * page; "7 out of 307 checks" reads as a mostly-correct one, and the second is
 * both the honest framing and the one a reviewer will actually act on.
 *
 * Like the wording review, nothing here becomes a bug without a human saying so.
 * A design file legitimately differs from a shipped page in many harmless ways.
 */

const PROPERTY_ICON: Record<string, string> = {
  'button height': '↕', // up-down arrow
  'corner radius': '◱', // shaded corner
  'font size': 'Aa',
  'font family': 'ƒ', // florin - stands in for a typeface
};

export function DesignIssuesPanel({
  issues,
  summary,
  onPromoted,
}: {
  issues: DesignIssue[];
  /** One line about what was read from Figma and how the comparison went. */
  summary?: string | null;
  onPromoted?: () => void;
}) {
  const [local, setLocal] = useState<Record<string, DesignIssue['status']>>({});
  const [raised, setRaised] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);

  const statusOf = (i: DesignIssue) => local[i.id] ?? i.status;

  const set = async (i: DesignIssue, status: DesignIssue['status']) => {
    setBusy(i.id);
    setError(null);
    const previous = statusOf(i);
    setLocal((m) => ({ ...m, [i.id]: status }));
    try {
      await reviewDesignIssue(i.id, status);
    } catch (err) {
      setLocal((m) => ({ ...m, [i.id]: previous }));
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const raise = async (i: DesignIssue) => {
    setBusy(i.id);
    setError(null);
    try {
      const res = await promoteDesignIssue(i.id);
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

  const failedOrUnusable = summary && /^Design (check failed|not usable)/.test(summary);

  if (failedOrUnusable) {
    return (
      <div className="banner banner-error">
        <strong>The design could not be compared.</strong>
        <div style={{ marginTop: 4 }}>{summary}</div>
      </div>
    );
  }

  if (!issues.length) {
    return (
      <div className="empty">
        <strong>The page matches the design.</strong>
        <div className="faint">
          {summary ?? 'No sizes, radii, type sizes or fonts were off the design spec.'}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="spread" style={{ marginBottom: 10 }}>
        <div>
          <strong>
            {open.length} design {open.length === 1 ? 'mismatch' : 'mismatches'}
          </strong>
          <div className="faint">{summary}</div>
          <div className="faint" style={{ marginTop: 4 }}>
            Only near-misses are reported. Something a pixel or two off a design value is
            almost certainly meant to be that value; something far off is usually a
            component the design does not cover, so it is left alone.
          </div>
        </div>
        {dismissed.length > 0 && (
          <button className="btn btn-sm" onClick={() => setShowDismissed((v) => !v)}>
            {showDismissed ? 'Hide' : 'Show'} {dismissed.length} dismissed
          </button>
        )}
      </div>

      {error && <div className="banner banner-error" style={{ marginBottom: 8 }}>{error}</div>}

      <div className="stack">
        {visible.map((i) => {
          const status = statusOf(i);
          const isDismissed = status === 'DISMISSED';
          return (
            <div
              key={i.id}
              className="card card-tight"
              style={{ opacity: isDismissed ? 0.5 : 1 }}
            >
              <div className="spread">
                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ marginBottom: 4 }}>
                    <span className="badge badge-neutral">
                      {PROPERTY_ICON[i.property] ?? ''} {i.property}
                    </span>
                    <strong style={{ wordBreak: 'break-word' }}>{i.element}</strong>
                    {i.offBy <= 2 && i.offBy < 99 && (
                      <span className="badge badge-warn" title="Very close to the design value">
                        {i.offBy}px off
                      </span>
                    )}
                  </div>

                  {/* Actual against expected, side by side. The reviewer should be
                      able to decide without opening Figma or the page. */}
                  <div className="row mono" style={{ gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--fail)' }}>page: {i.actual}</span>
                    <span className="faint">&rarr;</span>
                    <span style={{ color: 'var(--pass)' }}>design: {i.expected}</span>
                  </div>

                  <div className="faint mono" style={{ marginTop: 3, wordBreak: 'break-all' }}>
                    {i.selector}
                  </div>
                  {i.note && (
                    <div className="faint" style={{ marginTop: 3 }}>
                      {i.note}
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
                  ) : raised[i.id] ? (
                    <span className="badge badge-fail">{raised[i.id]} raised</span>
                  ) : (
                    <>
                      <button
                        className="btn btn-sm btn-primary"
                        disabled={busy === i.id}
                        onClick={() => raise(i)}
                        title="Create a real bug with a BUG id, PDF and ticket"
                      >
                        {busy === i.id ? <span className="spinner" /> : null} Raise bug
                      </button>
                      <button
                        className="btn btn-sm"
                        disabled={busy === i.id}
                        onClick={() => set(i, 'DISMISSED')}
                        title="Intentional, or a component the design does not cover"
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
