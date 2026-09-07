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
  // Sign-in URL. When set, the platform logs in once BEFORE scanning and reuses
  // that session for every test - the only way to test a page behind a login.
  const [loginUrl, setLoginUrl] = useState('');
  // WHOLE-APP SCOPE. Off by default: "test this page" is what most people mean
  // when they paste a URL, and a crawl nobody asked for spends their LLM quota.
  // Ticking it turns one page into the whole product.
  const [wholeApp, setWholeApp] = useState(false);
  const [maxPages, setMaxPages] = useState(10);
  const [maxDepth, setMaxDepth] = useState(2);
  const [excludePaths, setExcludePaths] = useState('');
  // Figma design to check the page against. One paste of the Figma URL fills
  // both - the backend pulls the file key and node id out of it.
  const [figmaUrl, setFigmaUrl] = useState('');
  // Which page the frame describes. Only asked for in whole-app mode: on a
  // single-page run there is exactly one candidate, so asking would be noise.
  const [designPageUrl, setDesignPageUrl] = useState('');
  const [showFigma, setShowFigma] = useState(false);

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
        loginUrl: loginUrl.trim() || undefined,
        // Same string for both: the backend extracts the file key from the path
        // and the node id from the query. Asking a user to split it by hand is
        // a needless way to get a support ticket.
        figmaFileKey: figmaUrl.trim() || undefined,
        figmaNodeId: figmaUrl.trim() || undefined,
        // Blank means "the entry URL", which the backend already defaults to.
        designPageUrl: designPageUrl.trim() || undefined,
        // Whole-app scope. The numbers are sent only when the crawl is on, so a
        // single-page run cannot be affected by a value left behind in the form.
        crawlEnabled: wholeApp,
        maxPages: wholeApp ? maxPages : undefined,
        maxDepth: wholeApp ? maxDepth : undefined,
        excludePaths: wholeApp
          ? excludePaths
              .split(',')
              .map((p) => p.trim())
              .filter(Boolean)
          : undefined,
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

      {/* ---------------------------------------------------- 1. what to test */}
      <div className="card composer-url">
        <div className="step-head">
          <span className="step-num">1</span>
          <div>
            <h2>{wholeApp ? 'Which app?' : 'Which page?'}</h2>
            <span className="faint">
              {wholeApp
                ? 'The front door of a staging or local app you are allowed to test.'
                : 'A staging or local page you are allowed to test.'}
            </span>
          </div>
        </div>
        <input
          type="url"
          required
          placeholder={
            wholeApp ? 'https://staging.yoursite.com' : 'https://staging.yoursite.com/login'
          }
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />

        {/* THE SCOPE SWITCH. One page, or the product. */}
        <label className="check-row" style={{ marginTop: 12 }}>
          <input
            type="checkbox"
            checked={wholeApp}
            onChange={(e) => setWholeApp(e.target.checked)}
          />
          <span>
            <strong>Test the whole app, not just this page</strong>
            <span className="faint" style={{ display: 'block' }}>
              We follow the links from this page to find your app&apos;s screens, then run
              every check you tick on all of them &mdash; one run, one approval, one bug
              list. External links, sign-out and anything destructive are never followed.
            </span>
          </span>
        </label>

        {wholeApp && (
          <div className="crawl-scope">
            <label className="field">
              <span className="field-label">Maximum pages</span>
              <input
                type="number"
                min={1}
                max={50}
                value={maxPages}
                onChange={(e) => setMaxPages(Number(e.target.value) || 1)}
              />
              <span className="field-hint">
                Each page costs one browser scan and one AI call, so this is the dial that
                decides how long the run takes. Start at 10.
              </span>
            </label>

            <label className="field">
              <span className="field-label">How deep to follow links</span>
              <select value={maxDepth} onChange={(e) => setMaxDepth(Number(e.target.value))}>
                <option value={1}>1 &mdash; only pages linked from the entry page</option>
                <option value={2}>2 &mdash; and the pages those link to</option>
                <option value={3}>3 &mdash; three clicks deep</option>
              </select>
              <span className="field-hint">
                Pages are found nearest-first, so a small page budget is spent on the
                screens a user actually reaches.
              </span>
            </label>

            <label className="field" style={{ marginBottom: 0 }}>
              <span className="field-label">Skip anything containing (optional)</span>
              <input
                type="text"
                autoComplete="off"
                placeholder="/admin, /billing, ?preview="
                value={excludePaths}
                onChange={(e) => setExcludePaths(e.target.value)}
              />
              <span className="field-hint">
                Comma-separated. Use it for areas you do not want an automated browser in.
              </span>
            </label>
          </div>
        )}
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
              Optional. Needed for the login checks, and for any page behind a sign-in.
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

            {/* The sign-in URL is what unlocks pages behind a login. Kept in
                this card because it is useless without the credentials above. */}
            <label className="field" style={{ marginTop: 14, marginBottom: 0 }}>
              <span className="field-label">
                Sign-in page URL <span className="faint">— only for pages behind a login</span>
              </span>
              <input
                type="url"
                autoComplete="off"
                placeholder="https://example.com/login"
                value={loginUrl}
                onChange={(e) => setLoginUrl(e.target.value)}
              />
              <span className="field-hint">
                Leave empty to test the page as a visitor. Fill it in and we sign in{' '}
                <strong>once</strong> before reading the page, then reuse that session for
                every test — otherwise a protected URL just redirects to the login screen
                and every test describes the wrong page. Must be on the same site.
              </span>
            </label>
          </>
        ) : (
          <span className="faint">
            {hasCredentials
              ? loginUrl.trim()
                ? `Credentials saved. Will sign in at ${loginUrl.trim()} before testing.`
                : 'Credentials saved for this run.'
              : 'No credentials — login checks are off.'}
          </span>
        )}
      </div>

      {/* ------------------------------------------------------- 5. figma */}
      <div className="card composer-figma">
        <div className="step-head">
          <span className="step-num">5</span>
          <div>
            <h2>Match against Figma</h2>
            <span className="faint">
              Optional. Checks one page against your design&apos;s sizes, colours, type,
              icons and spacing.
            </span>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ marginLeft: 'auto' }}
            onClick={() => setShowFigma((v) => !v)}
          >
            {showFigma ? 'Hide' : figmaUrl.trim() ? 'Edit' : 'Add'}
          </button>
        </div>

        {showFigma ? (
          <label className="field" style={{ marginBottom: 0 }}>
            <span className="field-label">Figma frame URL</span>
            <input
              type="url"
              autoComplete="off"
              placeholder="https://www.figma.com/design/AbC123/My-File?node-id=18-0"
              value={figmaUrl}
              onChange={(e) => setFigmaUrl(e.target.value)}
            />
            <span className="field-hint">
              Open the frame in Figma and copy the address bar &mdash; it needs the{' '}
              <code>node-id</code> on the end, so we read that frame and not the whole file.
              We read the design&apos;s button and input heights, corner radii, type scale,
              weights, text and surface colours, icon sizes and spacing scale, then flag
              anything on the page that is a hair off. Findings are suggestions, never
              automatic bugs.
            </span>
          </label>
        ) : (
          <span className="faint">
            {figmaUrl.trim() ? 'Design comparison is on for this run.' : 'No design comparison.'}
          </span>
        )}

        {/*
          WHICH page the frame describes.
          Only asked in whole-app mode: a Figma frame is one screen's design, so
          the comparison stays single-page however many pages the run tests.
          Checking a settings page against a login frame would report every
          button on it as wrong - a wall of confident, wrong findings.
        */}
        {showFigma && wholeApp && (
          <label className="field" style={{ marginTop: 12, marginBottom: 0 }}>
            <span className="field-label">Which page is this design for?</span>
            <input
              type="url"
              autoComplete="off"
              placeholder={url.trim() || 'https://staging.yoursite.com/login'}
              value={designPageUrl}
              onChange={(e) => setDesignPageUrl(e.target.value)}
            />
            <span className="field-hint">
              Leave blank to use the entry page. Every other check still runs on all the
              pages we find &mdash; only the design comparison is limited to this one,
              because a Figma frame is one screen&apos;s design.
            </span>
          </label>
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
