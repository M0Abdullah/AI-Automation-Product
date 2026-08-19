'use client';

import Link from 'next/link';
import { RunForm } from '../../../components/RunForm';

/**
 * The new-run screen. Split out from the dashboard so the landing page can be an
 * overview rather than a form - a dashboard that is mostly one empty form does
 * not tell you anything about your test suite.
 */
export default function NewRunPage() {
  return (
    <div className="grid-sidebar">
      <RunForm />

      <div className="stack">
        <div className="card">
          <div className="card-head">
            <h2>What makes a good requirement</h2>
          </div>
          <div className="stack-sm">
            <div>
              <div style={{ fontWeight: 620, color: 'var(--pass)' }}>Good</div>
              <div className="mono faint" style={{ marginTop: 4, lineHeight: 1.7 }}>
                Clicking Login with valid credentials opens /dashboard.
                <br />
                A wrong password shows an error message and stays on /login.
                <br />
                The email field rejects a value that is not an email address.
              </div>
            </div>
            <div style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 620, color: 'var(--fail)' }}>Too vague</div>
              <div className="mono faint" style={{ marginTop: 4, lineHeight: 1.7 }}>
                Test the login page
                <br />
                Check everything works
              </div>
            </div>
            <div className="faint" style={{ marginTop: 8 }}>
              Each line should say <strong>what you do</strong> and{' '}
              <strong>what should happen</strong>. The AI is forbidden from asserting anything you
              did not write, so a vague line produces vague tests.
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Where credentials go</h2>
          </div>
          <p className="faint">
            Put them in the <strong>Test credentials</strong> fields, never in the requirements
            text. Requirements are sent to the AI; credentials are encrypted and never leave the
            backend. The model only ever writes <code>test_email</code> and{' '}
            <code>test_password</code>, and the browser swaps in the real values at typing time.
          </p>
        </div>

        <Link href="/runs" className="btn btn-block">
          See all previous runs
        </Link>
      </div>
    </div>
  );
}
