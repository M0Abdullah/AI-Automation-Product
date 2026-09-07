'use client';

import { useEffect, useState } from 'react';
import { getIntegrations, verifyMail, verifyTracker } from '../lib/api';
import type { IntegrationStatus } from '../lib/types';

/**
 * WHAT THIS INSTANCE IS CONNECTED TO, and whether it actually works.
 *
 * Two questions, and they are not the same one: *is it configured* is answered
 * by reading env vars, and *does it work* needs a real call. A panel that only
 * answered the first would show a confident green tick next to an expired API
 * token — so each row carries its own **Test** button.
 *
 * Neither test creates anything. The tracker check reads the account and the
 * project; the mail check opens an SMTP connection and hangs up. A "test"
 * button that filed a junk issue into a real backlog, or put a test email in
 * somebody's inbox, would be worse than no button at all.
 */

type Check = { ok: boolean; detail: string } | null;

const PROVIDER_LABEL: Record<string, string> = {
  none: 'None',
  jira: 'Jira',
  clickup: 'ClickUp',
  linear: 'Linear',
};

export function IntegrationsPanel() {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [trackerCheck, setTrackerCheck] = useState<Check>(null);
  const [mailCheck, setMailCheck] = useState<Check>(null);

  useEffect(() => {
    getIntegrations()
      .then(setStatus)
      .catch((e) => setError((e as Error).message));
  }, []);

  const runCheck = async (which: 'tracker' | 'mail') => {
    setBusy(which);
    try {
      if (which === 'tracker') {
        const r = await verifyTracker();
        setTrackerCheck({ ok: r.ok, detail: r.detail });
      } else {
        setMailCheck(await verifyMail());
      }
    } catch (e) {
      const detail = (e as Error).message;
      if (which === 'tracker') setTrackerCheck({ ok: false, detail });
      else setMailCheck({ ok: false, detail });
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

  const t = status.tracker;
  const m = status.mail;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Integrations</h2>
          <span className="faint">
            Where confirmed bugs go, and who gets told. Both are configured in{' '}
            <code>backend/.env</code> and take effect on restart.
          </span>
        </div>
      </div>

      <div className="stack-sm">
        {/* ------------------------------------------------ issue tracker */}
        <div className="integration-row">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="row" style={{ marginBottom: 4, flexWrap: 'wrap' }}>
              <strong>Issue tracker</strong>
              <span className={`badge ${t.enabled ? 'badge-pass' : 'badge-neutral'}`}>
                {t.enabled ? PROVIDER_LABEL[t.provider] ?? t.provider : 'Not connected'}
              </span>
              {t.autoPush && (
                <span className="badge badge-info" title="Filed the moment a bug is confirmed">
                  automatic
                </span>
              )}
            </div>

            <div className="faint">{t.describe}</div>

            {t.enabled ? (
              <div className="faint" style={{ marginTop: 4 }}>
                {t.autoPush
                  ? 'A confirmed defect is filed automatically, with the bug report, the screenshot and the trace attached.'
                  : 'Tickets stay here until you press “Push” on one. Set TRACKER_AUTO_PUSH=true to file them the moment they are confirmed.'}
              </div>
            ) : (
              <div className="faint" style={{ marginTop: 4 }}>
                Bugs stay in this tool.{' '}
                {t.missingConfig.length > 0 && (
                  <>
                    Set{' '}
                    {t.missingConfig.map((v, i) => (
                      <span key={v}>
                        {i > 0 && ', '}
                        <code>{v}</code>
                      </span>
                    ))}{' '}
                    to file into Jira, ClickUp or Linear.
                  </>
                )}
              </div>
            )}

            {trackerCheck && (
              <div
                className={`banner ${trackerCheck.ok ? 'banner-success' : 'banner-error'}`}
                style={{ marginTop: 8, display: 'block' }}
              >
                {trackerCheck.detail}
              </div>
            )}
          </div>

          <button
            className="btn btn-sm"
            disabled={busy !== null}
            onClick={() => void runCheck('tracker')}
            title="Checks the credentials. Does not create an issue."
          >
            {busy === 'tracker' ? <span className="spinner" /> : null} Test
          </button>
        </div>

        {/* -------------------------------------------------------- email */}
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
                  {m.events.onRunFinished ? '✓' : '✗'} A pass/fail summary when a run or website
                  audit finishes
                </li>
                <li>
                  {m.events.onBugFiled ? '✓' : '✗'} The assignee is told when a confirmed bug becomes
                  theirs
                </li>
              </ul>
            )}

            {/* The mistake that produces emails nobody can use. */}
            {m.enabled && /localhost|127\.0\.0\.1/.test(m.appUrl) && (
              <div className="banner banner-warn" style={{ marginTop: 8, display: 'block' }}>
                <strong>Links in these emails point at {m.appUrl}.</strong>
                <div style={{ fontWeight: 400, marginTop: 2 }}>
                  They will only work on this machine. Set <code>APP_PUBLIC_URL</code> to the address
                  your team actually opens.
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
