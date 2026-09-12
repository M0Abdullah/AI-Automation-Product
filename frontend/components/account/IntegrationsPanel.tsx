'use client';

import { useEffect, useState } from 'react';
import { getIntegrations, verifyMail } from '@/lib/api';
import type { IntegrationStatus } from '@/lib/types';

/**
 * WHAT THIS INSTANCE IS CONNECTED TO, and whether it actually works.
 *
 * Two questions, and they are not the same one: *is it configured* is answered
 * by reading env vars, and *does it work* needs a real call. A panel that only
 * answered the first would show a confident green tick next to an expired
 * password — so the row carries its own **Test** button.
 *
 * The test creates nothing: it opens an SMTP connection and hangs up. A "test"
 * button that put a message in somebody's inbox would be worse than no button.
 */

type Check = { ok: boolean; detail: string } | null;

export function IntegrationsPanel() {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [mailCheck, setMailCheck] = useState<Check>(null);

  useEffect(() => {
    getIntegrations()
      .then(setStatus)
      .catch((e) => setError((e as Error).message));
  }, []);

  const runCheck = async (which: 'mail') => {
    setBusy(which);
    try {
      setMailCheck(await verifyMail());
    } catch (e) {
      setMailCheck({ ok: false, detail: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  if (error) {
    return (
      <div className="card">
        <div className="card-head">
          <h2>Integrations</h2>
        </div>
        <div className="banner banner-error">{error}</div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="card">
        <div className="card-head">
          <h2>Integrations</h2>
        </div>
        <div className="faint">
          <span className="spinner" /> Loading
        </div>
      </div>
    );
  }

  const m = status.mail;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Integrations</h2>
          <span className="faint">
            Who gets told, and when. Configured in <code>backend/.env</code>; takes effect on
            restart.
          </span>
        </div>
      </div>

      <div className="stack-sm">
        <div className="integration-row">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="row" style={{ marginBottom: 4, flexWrap: 'wrap' }}>
              <strong>Email notifications</strong>
              <span className={`badge ${m.enabled ? 'badge-pass' : 'badge-neutral'}`}>
                {m.enabled ? 'On' : 'Off'}
              </span>
            </div>

            <div className="faint">
              {m.enabled
                ? `${m.host}:${m.port} · from ${m.from}`
                : 'No mail server configured. Everything else works without one.'}
            </div>

            {m.enabled && (
              <ul className="faint" style={{ margin: '6px 0 0 16px' }}>
                <li>
                  {m.events.onLogin ? '✓' : '✗'} A security alert on every sign-in, with the IP and
                  device
                </li>
                <li>
                  {m.events.onUserJoined ? '✓' : '✗'} The owners are told when somebody creates an
                  account
                </li>
                <li>
                  {m.events.onRunStarted ? '✓' : '✗'} “Testing has started”, once the pages are
                  known
                </li>
                <li>
                  {m.events.onRunFinished ? '✓' : '✗'} The result when a run finishes — every
                  failure, with the reason for each
                </li>
              </ul>
            )}

            {/* The mistake that produces emails nobody can use. */}
            {m.enabled && /localhost|127\.0\.0\.1/.test(m.appUrl) && (
              <div className="banner banner-warn" style={{ marginTop: 8, display: 'block' }}>
                <strong>Links in these emails point at {m.appUrl}.</strong>
                <div style={{ fontWeight: 400, marginTop: 2 }}>
                  They will only work on this machine. Set <code>APP_PUBLIC_URL</code> to the
                  address your team actually opens.
                </div>
              </div>
            )}

            {mailCheck && (
              <div
                className={`banner ${mailCheck.ok ? 'banner-success' : 'banner-error'}`}
                style={{ marginTop: 8, display: 'block' }}
              >
                {mailCheck.detail}
              </div>
            )}
          </div>

          <button
            className="btn btn-sm"
            disabled={busy !== null}
            onClick={() => void runCheck('mail')}
            title="Opens an SMTP connection. Does not send a message."
          >
            {busy === 'mail' ? <span className="spinner" /> : null} Test
          </button>
        </div>
      </div>
    </div>
  );
}
