'use client';

import { useState } from 'react';
import { promoteDesignIssue, reviewDesignIssue } from '@/lib/api';
import type { DesignIssue, DesignIssueGroup } from '@/lib/types';

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
  'control height': '↕',
  'corner radius': '◱', // shaded corner
  'icon size': '✦', // four-pointed star - stands in for a glyph
  padding: '▣', // square within a square
  gap: '↔',
  'font size': 'Aa',
  'font weight': 'B',
  'font family': 'ƒ', // florin - stands in for a typeface
  'text colour': '●',
  'background colour': '●',
  'border colour': '○',
};

/**
 * FILTERING BY FAMILY.
 *
 * Eleven properties are checked now rather than four, so a page with real drift
 * can produce a long list. Grouping is what keeps it readable: a reviewer
 * usually cares about one class at a time, and "stop showing me colours" is a
 * reasonable thing to want - much better than abandoning the tab entirely.
 */
const GROUP_LABEL: Record<DesignIssueGroup, string> = {
  SIZE: 'Sizes',
  TYPOGRAPHY: 'Type',
  COLOUR: 'Colour',
  SPACING: 'Spacing',
  ICON: 'Icons',
};

/** Rows written before grouping existed have no `group`; infer it from the name. */
function groupOf(i: DesignIssue): DesignIssueGroup {
  if (i.group) return i.group;
  if (i.property.includes('colour') || i.property.includes('color')) return 'COLOUR';
  if (i.property.startsWith('font')) return 'TYPOGRAPHY';
  if (i.property === 'icon size') return 'ICON';
  if (i.property === 'padding' || i.property === 'gap') return 'SPACING';
  return 'SIZE';
}

/**
 * A colour finding is the one case where the words are useless on their own.
 *
 * "#6B7280 should be #4B5563" means nothing to anyone; two swatches side by
 * side answer "is this a real mistake?" instantly, which is the only question
 * this panel exists to help with.
 */
function Swatch({ value }: { value: string }) {
  if (!/^#[0-9a-f]{6}$/i.test(value.trim())) return null;
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: 12,
        height: 12,
        borderRadius: 3,
        background: value.trim(),
        border: '1px solid var(--border)',
        verticalAlign: 'middle',
        marginRight: 5,
      }}
    />
  );
}

export function DesignIssuesPanel({
  issues,
  summary,
  pageUrl,
  onPromoted,
}: {
  issues: DesignIssue[];
  /** One line about what was read from Figma and how the comparison went. */
  summary?: string | null;
  /**
   * The ONE page the design was compared against.
   *
   * Shown because on a whole-app run the obvious assumption is that every page
   * was checked, and it was not - stating which page keeps the report honest.
   */
  pageUrl?: string | null;
  onPromoted?: () => void;
}) {
  const [local, setLocal] = useState<Record<string, DesignIssue['status']>>({});
  const [raised, setRaised] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);
  // null = every family. Set by the chips above the list.
  const [group, setGroup] = useState<DesignIssueGroup | null>(null);

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
  const inScope = showDismissed ? [...open, ...dismissed] : open;
  const visible = group ? inScope.filter((i) => groupOf(i) === group) : inScope;

  // Counted over the OPEN rows only, so a chip never advertises work that has
  // already been dismissed.
  const counts = open.reduce<Record<string, number>>((acc, i) => {
    const g = groupOf(i);
    acc[g] = (acc[g] ?? 0) + 1;
    return acc;
  }, {});

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
          {summary ??
            'No sizes, radii, type, weights, colours, icon sizes or spacing were off the ' +
              'design spec.'}
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
            Only near-misses are reported. Something a pixel or a shade off a design value is almost
            certainly meant to be that value; something far off is usually a component the design
            does not cover, so it is left alone. Positions, arbitrary widths and pixel diffing are
            still not checked.
          </div>
          {pageUrl && (
            <div className="faint" style={{ marginTop: 4 }}>
              Compared against <span className="mono">{pageUrl}</span>. A Figma frame is one
              screen&apos;s design, so this check stays on that page even when the run tests the
              whole app.
            </div>
          )}
        </div>
        {dismissed.length > 0 && (
          <button className="btn btn-sm" onClick={() => setShowDismissed((v) => !v)}>
            {showDismissed ? 'Hide' : 'Show'} {dismissed.length} dismissed
          </button>
        )}
      </div>

      {/* One family at a time, when there is more than one to choose between. */}
      {Object.keys(counts).length > 1 && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          <button
            className={`btn btn-sm ${group === null ? 'btn-primary' : ''}`}
            onClick={() => setGroup(null)}
          >
            All {open.length}
          </button>
          {(Object.keys(GROUP_LABEL) as DesignIssueGroup[])
            .filter((g) => counts[g])
            .map((g) => (
              <button
                key={g}
                className={`btn btn-sm ${group === g ? 'btn-primary' : ''}`}
                onClick={() => setGroup(group === g ? null : g)}
              >
                {GROUP_LABEL[g]} {counts[g]}
              </button>
            ))}
        </div>
      )}

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
                    <span className="badge badge-neutral">
                      {PROPERTY_ICON[i.property] ?? ''} {i.property}
                    </span>
                    <strong style={{ wordBreak: 'break-word' }}>{i.element}</strong>
                    {/* Units differ by family: px for geometry and type, a
                        perceptual distance for colour. Labelling a colour
                        "12px off" would be nonsense. */}
                    {i.offBy <= 2 && i.offBy < 99 && groupOf(i) !== 'COLOUR' && (
                      <span className="badge badge-warn" title="Very close to the design value">
                        {i.offBy}px off
                      </span>
                    )}
                    {groupOf(i) === 'COLOUR' && i.offBy <= 20 && (
                      <span
                        className="badge badge-warn"
                        title="Nearly the design colour - almost certainly meant to be it"
                      >
                        very close
                      </span>
                    )}
                  </div>

                  {/* Actual against expected, side by side. The reviewer should be
                      able to decide without opening Figma or the page. */}
                  <div className="row mono" style={{ gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--fail)' }}>
                      <Swatch value={i.actual} />
                      page: {i.actual}
                    </span>
                    <span className="faint">&rarr;</span>
                    <span style={{ color: 'var(--pass)' }}>
                      <Swatch value={i.expected} />
                      design: {i.expected}
                    </span>
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
