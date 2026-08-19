'use client';

import { useEffect, useState } from 'react';
import { artifactUrl, getResult } from '../lib/api';
import type { ResultDetail } from '../lib/types';
import { ScreenshotPanel } from './ScreenshotPanel';
import { ExecutedSteps } from './StepTimeline';
import { ResultStatusBadge } from './StatusBadge';

/**
 * THE "WHY DID IT FAIL" PANEL.
 *
 * Everything a QA engineer needs to judge a failure without opening a browser:
 *   - expected vs actual, side by side
 *   - the step timeline with the exact failing step
 *   - console errors
 *   - failed API requests with status codes
 *   - the screenshot at the moment of failure
 *   - the Playwright trace to download
 */
export function ResultEvidence({ resultId }: { resultId: string }) {
  const [result, setResult] = useState<ResultDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getResult(resultId)
      .then((r) => !cancelled && setResult(r))
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [resultId]);

  if (error) return <div className="banner banner-error">{error}</div>;
  if (!result)
    return (
      <div className="faint">
        <span className="spinner" /> Loading evidence
      </div>
    );

  const failed = result.status === 'FAIL' || result.status === 'ERROR';

  return (
    <div className="stack">
      <div className="row">
        <ResultStatusBadge status={result.status} />
        <span className="pill">attempt {result.attempt}</span>
        <span className="pill">{result.durationMs}ms</span>
        <span className="pill">
          {result.browserName} {result.browserVersion ?? ''}
        </span>
        {result.viewport && <span className="pill">{result.viewport}</span>}
        <span className="faint">{new Date(result.startedAt).toLocaleString()}</span>
      </div>

      {failed && (
        <>
          <div className="banner banner-error">
            <div>
              <strong>{result.errorType ?? 'FAILURE'}</strong>
              {result.failedStepLabel && <> at {result.failedStepLabel}</>}
              <div style={{ marginTop: 4, fontWeight: 400 }}>{result.errorMessage}</div>
            </div>
          </div>

          {(result.expected || result.actual) && (
            <div className="compare">
              <div className="compare-box compare-expected">
                <div className="compare-label">Expected</div>
                <div className="mono">{result.expected ?? '-'}</div>
              </div>
              <div className="compare-box compare-actual">
                <div className="compare-label">Actual</div>
                <div className="mono">{result.actual ?? '-'}</div>
              </div>
            </div>
          )}
        </>
      )}

      {result.finalUrl && (
        <div className="faint mono" style={{ wordBreak: 'break-all' }}>
          Final URL: {result.finalUrl}
        </div>
      )}

      <div className="card card-tight">
        <ExecutedSteps stepResults={result.stepResults} />
      </div>

      {/* ------------------------------------------------ API / network errors */}
      <details className="collapse" open={result.apiErrors.length > 0}>
        <summary>
          Failed API requests ({result.apiErrors.length})
          {result.apiErrors.length > 0 && (
            <span className="badge badge-fail" style={{ marginLeft: 8 }}>
              {result.apiErrors.length}
            </span>
          )}
        </summary>
        {result.apiErrors.length === 0 ? (
          <div className="faint">No failed requests. The network was clean.</div>
        ) : (
          <div className="logbox">
            {result.apiErrors.map((n) => (
              <div className="log-line log-err" key={n.id}>
                {n.method} {n.url}
                {' → '}
                {n.failureText ? `NETWORK FAILURE: ${n.failureText}` : `${n.status} ${n.statusText ?? ''}`}
                {n.durationMs ? ` (${n.durationMs}ms)` : ''}
              </div>
            ))}
          </div>
        )}
      </details>

      {/* ---------------------------------------------------- console errors */}
      <details className="collapse" open={result.consoleErrors.length > 0}>
        <summary>
          Console errors ({result.consoleErrors.length})
          {result.consoleErrors.length > 0 && (
            <span className="badge badge-fail" style={{ marginLeft: 8 }}>
              {result.consoleErrors.length}
            </span>
          )}
        </summary>
        {result.consoleErrors.length === 0 ? (
          <div className="faint">No console errors.</div>
        ) : (
          <div className="logbox">
            {result.consoleErrors.map((c) => (
              <div className="log-line log-err" key={c.id}>
                {c.message}
                {c.location ? `  (${c.location})` : ''}
              </div>
            ))}
          </div>
        )}
      </details>

      {result.consoleWarnings.length > 0 && (
        <details className="collapse">
          <summary>Console warnings ({result.consoleWarnings.length})</summary>
          <div className="logbox">
            {result.consoleWarnings.map((c) => (
              <div className="log-line log-warn" key={c.id}>
                {c.message}
              </div>
            ))}
          </div>
        </details>
      )}

      <details className="collapse">
        <summary>All network traffic ({result.networkLogs.length})</summary>
        <div className="logbox">
          {result.networkLogs.map((n) => (
            <div className={`log-line ${n.isApiError ? 'log-err' : ''}`} key={n.id}>
              {n.status ?? 'ERR'} {n.method} {n.url}
            </div>
          ))}
        </div>
      </details>

      {/* ------------------------------------------------------------ artifacts */}
      {(result.screenshotPath || result.tracePath) && (
        <div className="card card-tight">
          <div className="faint" style={{ marginBottom: 7 }}>
            EVIDENCE
          </div>
          <ScreenshotPanel
            screenshotPath={result.screenshotPath}
            tracePath={result.tracePath}
            caption={`Attempt ${result.attempt} · ${result.browserName} ${result.viewport ?? ''}`}
          />
        </div>
      )}
    </div>
  );
}
