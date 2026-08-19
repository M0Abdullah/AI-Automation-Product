'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, createRun } from '../lib/api';

/**
 * EVERYTHING WE ASK THE USER FOR.
 *
 * Three inputs and one checkbox. That is the whole MVP surface:
 *   1. the page URL
 *   2. the requirements, in plain English
 *   3. test credentials (optional)
 *   + confirmation that they are allowed to test this site
 */

const EXAMPLE_REQUIREMENTS = `A user can type an email address.
A user can type a password.
Clicking Login with valid credentials opens the dashboard.
Clicking Login with a wrong password shows an error message.
The email field is required and shows a message when left empty.`;

export function RunForm() {
  const router = useRouter();

  const [url, setUrl] = useState('');
  const [requirements, setRequirements] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [allowDestructive, setAllowDestructive] = useState(false);
  const [showCreds, setShowCreds] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[]>([]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setDetails([]);
    setSubmitting(true);

    try {
      const run = await createRun({
        url: url.trim(),
        requirements: requirements.trim(),
        name: name.trim() || undefined,
        authorized,
        allowDestructive,
        credentials:
          email || password
            ? { email: email || undefined, password: password || undefined }
            : undefined,
      });
      router.push(`/runs/${run.id}`);
    } catch (err) {
      const e = err as ApiError;
      setError(e.message);
      if (Array.isArray(e.details)) setDetails(e.details as string[]);
      setSubmitting(false);
    }
  };

  return (
    <form className="card" onSubmit={submit}>
      <div className="card-head">
        <div>
          <h2>Start a test run</h2>
          <span className="faint">
            Give a page and describe what should work. The AI proposes test cases; you approve them
            before anything runs.
          </span>
        </div>
      </div>

      {error && (
        <div className="banner banner-error" style={{ marginBottom: 14 }}>
          <div>
            <strong>{error}</strong>
            {details.length > 0 && (
              <ul style={{ margin: '6px 0 0 16px' }}>
                {details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <label className="field">
        <span className="field-label">1. Page URL</span>
        <span className="field-hint">
          A staging or local page you are authorised to test. Include http:// or https://
        </span>
        <input
          type="url"
          required
          placeholder="https://staging.yoursite.com/login"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>

      <label className="field">
        <span className="field-label">2. Requirements</span>
        <span className="field-hint">
          One per line, plain English. This is the source of truth - the AI is not allowed to assert
          anything you did not write here.
        </span>
        <textarea
          required
          rows={8}
          placeholder={EXAMPLE_REQUIREMENTS}
          value={requirements}
          onChange={(e) => setRequirements(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          style={{ marginTop: 6 }}
          onClick={() => setRequirements(EXAMPLE_REQUIREMENTS)}
        >
          Use the login example
        </button>
      </label>

      <div className="field">
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => setShowCreds((v) => !v)}
        >
          {showCreds ? '▾' : '▸'} 3. Test credentials (optional)
        </button>
        {showCreds && (
          <div className="card card-tight" style={{ marginTop: 8 }}>
            <span className="field-hint">
              Encrypted before storage. The AI never sees these values - it only writes{' '}
              <code>test_email</code> and <code>test_password</code> references, and the browser
              swaps in the real value at typing time.
            </span>
            <div className="grid-2" style={{ marginTop: 8 }}>
              <label className="field" style={{ marginBottom: 0 }}>
                <span className="field-label">Test email</span>
                <input
                  type="text"
                  autoComplete="off"
                  placeholder="test@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label className="field" style={{ marginBottom: 0 }}>
                <span className="field-label">Test password</span>
                <input
                  type="password"
                  autoComplete="off"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
            </div>
          </div>
        )}
      </div>

      <label className="field">
        <span className="field-label">Run name (optional)</span>
        <input
          type="text"
          placeholder="Login smoke - sprint 12"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 4 }}>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={authorized}
            onChange={(e) => setAuthorized(e.target.checked)}
          />
          <span>
            <strong>I am authorised to test this website.</strong>
            <br />
            <span className="faint">
              Required. An automated browser will open the page and interact with it.
            </span>
          </span>
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={allowDestructive}
            onChange={(e) => setAllowDestructive(e.target.checked)}
          />
          <span>
            Allow destructive actions (delete, pay, send)
            <br />
            <span className="faint">
              Leave this off. When off, any step whose target contains a destructive keyword is
              rejected before it can run.
            </span>
          </span>
        </label>
      </div>

      <button
        type="submit"
        className="btn btn-primary"
        disabled={submitting || !authorized}
        style={{ marginTop: 8 }}
      >
        {submitting ? (
          <>
            <span className="spinner" /> Starting
          </>
        ) : (
          'Scan page and generate test cases'
        )}
      </button>
      {!authorized && (
        <span className="faint" style={{ marginLeft: 10 }}>
          Tick the authorisation box to continue.
        </span>
      )}
    </form>
  );
}
