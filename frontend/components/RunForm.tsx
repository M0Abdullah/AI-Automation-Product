'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, createRun, getCapabilities } from '../lib/api';
import type { CheckOption } from '../lib/types';
import { CheckPicker } from './CheckPicker';

/**
 * EVERYTHING WE ASK THE USER FOR.
 *
 * Step 1  the URL
 * Step 2  tick what to check          <- covers the standard stuff, no writing
 * Step 3  describe your own rules     <- optional, for business logic only
 * Step 4  test credentials            <- optional
 * + the authorisation confirmation
 *
 * The checklist exists because free text alone was unforgiving: "test the login
 * page" produced three tests that only confirmed the fields existed. Ticking
 * boxes gives the model precise instructions with nothing to write.
 */

const EXAMPLE_REQUIREMENTS = `Clicking Login with valid credentials opens /dashboard.
A wrong password shows an error message and stays on /login.
The email field rejects a value that is not an email address.`;

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

  const [options, setOptions] = useState<CheckOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[]>([]);

  // The catalogue and its defaults both come from the backend, so the ticked
  // boxes on first load are the ones the server considers cheap and useful.
  useEffect(() => {
    getCapabilities()
      .then((caps) => {
        setOptions(caps.checks ?? []);
        setSelected((caps.checks ?? []).filter((c) => c.defaultOn).map((c) => c.id));
      })
      .catch(() => setOptions([]));
  }, []);

  const hasCredentials = Boolean(email.trim() || password.trim());
  const ready = authorized && url.trim().length > 0 && (selected.length > 0 || requirements.trim().length >= 10);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setDetails([]);
    setSubmitting(true);

    try {
      const run = await createRun({
        url: url.trim(),
        requirements: requirements.trim() || undefined,
        checks: selected,
        name: name.trim() || undefined,
        authorized,
        allowDestructive,
        credentials: hasCredentials
          ? { email: email.trim() || undefined, password: password || undefined }
          : undefined,
      });
      router.push(`/runs/${run.id}`);
    } catch (err) {
      const e2 = err as ApiError;
      setError(e2.message);
      if (Array.isArray(e2.details)) setDetails(e2.details as string[]);
      setSubmitting(false);
    }
  };

  return (
    <form className="test-composer" onSubmit={submit}>
      {error && (
        <div className="banner banner-error">
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

      {/* ------------------------------------------------------- 1. the URL */}
      <div className="card composer-url">
        <div className="step-head">
          <span className="step-num">1</span>
          <div>
            <h2>Which page?</h2>
            <span className="faint">A staging or local page you are allowed to test.</span>
          </div>
        </div>
        <input
          type="url"
          required
          placeholder="https://staging.yoursite.com/login"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>

      {/* --------------------------------------------------- 2. the checklist */}
      <div className="card composer-checks">
        <div className="step-head">
          <span className="step-num">2</span>
          <div>
            <h2>What should we check?</h2>
            <span className="faint">
              Tick the boxes. These need no writing — they work on any page.
            </span>
          </div>
        </div>

        {options.length === 0 ? (
          <div className="faint">
            <span className="spinner" /> Loading the checklist
          </div>
        ) : (
          <CheckPicker
            options={options}
            selected={selected}
            onChange={setSelected}
            hasCredentials={hasCredentials}
          />
        )}
      </div>

      {/* ------------------------------------------------- 3. your own rules */}
      <div className="card composer-rules">
        <div className="step-head">
          <span className="step-num">3</span>
          <div>
            <h2>Your own rules</h2>
            <span className="faint">
              Optional. For things only you know — what happens after login, what a
              discount should do. One per line.
            </span>
          </div>
        </div>
        <textarea
          rows={6}
          placeholder={EXAMPLE_REQUIREMENTS}
          value={requirements}
          onChange={(e) => setRequirements(e.target.value)}
        />
        <div className="row" style={{ marginTop: 7 }}>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => setRequirements(EXAMPLE_REQUIREMENTS)}
          >
            Use an example
          </button>
          <span className="faint">
            The AI may not assert anything you did not write here.
          </span>
        </div>
      </div>

      {/* --------------------------------------------------- 4. credentials */}
      <div className="card composer-login">
        <div className="step-head">
          <span className="step-num">4</span>
          <div>
            <h2>Test login</h2>
            <span className="faint">
              Optional. Needed only for the two login checks.
            </span>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ marginLeft: 'auto' }}
            onClick={() => setShowCreds((v) => !v)}
          >
            {showCreds ? 'Hide' : hasCredentials ? 'Edit' : 'Add'}
          </button>
        </div>

        {showCreds ? (
          <>
            <span className="field-hint">
              Encrypted before storage. The AI never sees these values — it writes{' '}
              <code>test_email</code> / <code>test_password</code>, and the browser swaps in the
              real value at typing time.
            </span>
            <div className="grid-2">
              <label className="field" style={{ marginBottom: 0 }}>
                <span className="field-label">Email or username</span>
                <input
                  type="text"
                  autoComplete="off"
                  placeholder="test@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label className="field" style={{ marginBottom: 0 }}>
                <span className="field-label">Password</span>
                <input
                  type="password"
                  autoComplete="off"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
            </div>
          </>
        ) : (
          <span className="faint">
            {hasCredentials ? 'Credentials saved for this run.' : 'No credentials — login checks are off.'}
          </span>
        )}
      </div>

      {/* ------------------------------------------------------ confirm + go */}
      <div className="card composer-submit">
        <label className="field" style={{ marginBottom: 14 }}>
          <span className="field-label">Name this run (optional)</span>
          <input
            type="text"
            placeholder="Login smoke - sprint 12"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={authorized}
            onChange={(e) => setAuthorized(e.target.checked)}
          />
          <span>
            <strong>I am allowed to test this website.</strong>
            <br />
            <span className="faint">
              Required. A real browser will open the page and interact with it.
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
            Allow Delete / Pay / Send buttons
            <br />
            <span className="faint">
              Leave this off. When off, any step targeting those words is blocked before it runs.
            </span>
          </span>
        </label>

        <button
          type="submit"
          className="btn btn-primary btn-lg btn-block"
          disabled={submitting || !ready}
          style={{ marginTop: 6 }}
        >
          {submitting ? (
            <>
              <span className="spinner" /> Starting
            </>
          ) : (
            'Read the page and write the tests'
          )}
        </button>

        {!ready && (
          <div className="faint" style={{ marginTop: 8, textAlign: 'center' }}>
            {!url.trim()
              ? 'Add a page URL to continue.'
              : selected.length === 0 && requirements.trim().length < 10
                ? 'Tick at least one check, or write your own rules.'
                : 'Tick the authorisation box to continue.'}
          </div>
        )}
      </div>
    </form>
  );
}
