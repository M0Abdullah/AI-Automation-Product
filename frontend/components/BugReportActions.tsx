'use client';

import { useState } from 'react';
import { downloadReport, fetchReportMarkdown, reportUrl } from '../lib/api';
import type { Finding } from '../lib/types';

/**
 * The three ways to get a bug report out of the platform:
 *   PDF      — attach to an email, hand to a manager
 *   Copy     — paste straight into Jira, Slack or a PR description
 *   Open     — read the printable version in a tab
 *
 * All three come from the same server-side builder, so they cannot disagree.
 */
export function BugReportActions({ finding }: { finding: Finding }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const bugKey = finding.bugKey ?? `DRAFT-${finding.id.slice(0, 8)}`;

  const flash = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2200);
  };

  const onPdf = async () => {
    setBusy('pdf');
    setError(null);
    try {
      await downloadReport(finding.id, bugKey);
      flash(`${bugKey}.pdf downloaded`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onCopy = async () => {
    setBusy('copy');
    setError(null);
    try {
      const md = await fetchReportMarkdown(finding.id);
      await navigator.clipboard.writeText(md);
      flash('Bug report copied as Markdown');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="row">
        <button className="btn btn-sm" onClick={onPdf} disabled={busy !== null}>
          {busy === 'pdf' ? <span className="spinner" /> : '⤓'} PDF
        </button>
        <button className="btn btn-sm" onClick={onCopy} disabled={busy !== null}>
          {busy === 'copy' ? <span className="spinner" /> : '⧉'} Copy Markdown
        </button>
        <a
          className="btn btn-sm"
          href={reportUrl(finding.id, 'html')}
          target="_blank"
          rel="noreferrer"
        >
          ↗ Open report
        </a>
        {!finding.bugKey && (
          <span className="faint">
            Confirm the finding to assign a permanent BUG id.
          </span>
        )}
      </div>

      {error && (
        <div className="banner banner-error" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}
      {toast && <div className="copy-toast">{toast}</div>}
    </>
  );
}
