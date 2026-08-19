'use client';

import { useState } from 'react';
import { artifactUrl } from '../lib/api';

/**
 * THE SCREENSHOT, VISIBLE WITHOUT DIGGING.
 *
 * A bug report where the picture is two clicks deep is a bug report nobody
 * looks at. This shows a real thumbnail inline, expands to full size on click,
 * and offers the trace next to it — because "what did the page look like" is the
 * first question anyone asks about a failure.
 */
export function ScreenshotPanel({
  screenshotPath,
  tracePath,
  caption,
}: {
  screenshotPath?: string | null;
  tracePath?: string | null;
  caption?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!screenshotPath && !tracePath) {
    return (
      <div className="faint">
        No screenshot for this result — it passed, so nothing was captured.
      </div>
    );
  }

  const src = screenshotPath ? artifactUrl(screenshotPath) : null;

  return (
    <div className="stack-sm">
      {src && (
        <>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            title="Click to view full size"
            style={{
              padding: 0,
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--surface-2)',
              cursor: 'zoom-in',
              overflow: 'hidden',
              display: 'block',
              width: '100%',
              // Full-page screenshots are very tall; cropping to a strip keeps
              // the layout readable while still showing the failure state.
              maxHeight: 260,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={caption ?? 'Screenshot captured when the test failed'}
              style={{ width: '100%', display: 'block', objectFit: 'cover', objectPosition: 'top' }}
            />
          </button>

          <div className="row faint">
            <span>{caption ?? 'Captured at the moment of failure'}</span>
            <span>·</span>
            <button className="btn btn-sm btn-ghost" onClick={() => setExpanded(true)}>
              View full size
            </button>
            <a className="btn btn-sm btn-ghost" href={src} target="_blank" rel="noreferrer">
              Open in new tab
            </a>
          </div>
        </>
      )}

      {tracePath && (
        <div className="row">
          <a className="btn btn-sm" href={artifactUrl(tracePath)} download>
            ⤓ Download Playwright trace
          </a>
          <span className="faint">
            Open it at trace.playwright.dev to step through the run frame by frame.
          </span>
        </div>
      )}

      {expanded && src && (
        <div
          onClick={() => setExpanded(false)}
          role="dialog"
          aria-label="Screenshot full size"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(8, 10, 15, 0.86)',
            zIndex: 200,
            padding: 24,
            overflow: 'auto',
            cursor: 'zoom-out',
          }}
        >
          <div className="spread" style={{ marginBottom: 12 }}>
            <span style={{ color: '#fff', fontWeight: 600 }}>
              {caption ?? 'Screenshot at failure'}
            </span>
            <button className="btn btn-sm" onClick={() => setExpanded(false)}>
              Close
            </button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={caption ?? 'Screenshot captured when the test failed'}
            style={{
              width: '100%',
              maxWidth: 1400,
              margin: '0 auto',
              display: 'block',
              borderRadius: 8,
              background: '#fff',
            }}
          />
        </div>
      )}
    </div>
  );
}
