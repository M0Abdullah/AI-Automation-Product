import { Injectable, Logger } from '@nestjs/common';
import type { Page } from 'playwright';
import { AppConfigService } from '../config/app-config.service';
import { BrowserFactory, type StorageState } from './browser.factory';
import { LocatorNotFoundError } from './browser.types';
import { resolveLocator } from './locator-resolver';
import { waitForInteractiveContent } from './page-settle';

/**
 * SIGNING IN ONCE, SO EVERY LATER TEST IS ALREADY AUTHENTICATED.
 *
 * Before this existed, every browser context started logged out. Point the
 * platform at /employee/attendance and the app correctly bounced it to /login -
 * so the scan described the LOGIN page while believing it was the attendance
 * page, and all eight generated tests asserted against a page they never saw.
 *
 * This service signs in once, captures the resulting cookies and localStorage,
 * and that state is then handed to the scanner and to every test.
 *
 * The sign-in is deliberately NOT an LLM-planned test case: it has to be
 * deterministic, a human must not be able to approve it away, and it must never
 * show up in the results as a pass or a fail.
 */

export interface SessionResult {
  storageState: StorageState;
  /** Where the browser ended up after signing in. Proof it worked. */
  landedOn: string;
  /** How we knew the sign-in succeeded, recorded in the run log. */
  evidence: string;
  durationMs: number;
}

export class LoginFailedError extends Error {
  constructor(
    message: string,
    readonly landedOn: string,
    readonly hint: string,
  ) {
    super(message);
    this.name = 'LoginFailedError';
  }
}

/** Field names tried, in order, when the caller gave no explicit hint. */
const EMAIL_TARGETS = ['Email', 'Email address', 'Username', 'User name', 'Login', 'email'];
const PASSWORD_TARGETS = ['Password', 'password', 'Pass'];
const SUBMIT_TARGETS = ['Log in', 'Login', 'Sign in', 'Signin', 'Submit', 'Continue', 'Next'];

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly browsers: BrowserFactory,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Sign in and return the browser state that proves it.
   *
   * Throws LoginFailedError carrying a human-readable hint rather than a generic
   * error: "login failed" is useless to a QA engineer, whereas "still on the
   * login page and an error message appeared" tells them their credentials are
   * probably wrong.
   */
  async establish(args: {
    loginUrl: string;
    email: string;
    password: string;
    /** Explicit field labels, for when auto-detection is not enough. */
    emailField?: string;
    passwordField?: string;
    submitButton?: string;
  }): Promise<SessionResult> {
    const started = Date.now();
    const { settleTimeout, settlePoll, settleGrace, actionTimeout } = this.config.browser;
    const settle = { timeoutMs: settleTimeout, pollMs: settlePoll, graceMs: settleGrace };

    const context = await this.browsers.newContext();
    const page = await context.newPage();

    try {
      await page.goto(args.loginUrl, { waitUntil: 'domcontentloaded' });
      await waitForInteractiveContent(page, settle);

      const loginUrlBefore = page.url();

      await this.fillFirstMatch(
        page,
        args.emailField ? [args.emailField] : EMAIL_TARGETS,
        args.email,
        'the email or username field',
        actionTimeout,
        'not-password',
      );
      await this.fillFirstMatch(
        page,
        args.passwordField ? [args.passwordField] : PASSWORD_TARGETS,
        args.password,
        'the password field',
        actionTimeout,
        'password',
      );
      // Explicit label if we were given one; otherwise submitForm works
      // through genuine submit controls before any name matching.
      await this.submitForm(page, args.submitButton ? [args.submitButton] : null, actionTimeout);

      // Two different things count as success and apps differ on which they do:
      // navigating away, or staying on the same URL and swapping the content
      // (single-page apps). Wait for either, then judge from the evidence.
      await page
        .waitForURL((u) => u.toString() !== loginUrlBefore, { timeout: actionTimeout })
        .catch(() => undefined);
      await waitForInteractiveContent(page, settle);

      const landedOn = page.url();
      const evidence = await this.verify(page, loginUrlBefore, landedOn);

      // Captured only AFTER verification passes, so a half-authenticated state
      // is never handed to the rest of the run.
      const storageState = (await context.storageState()) as StorageState;

      this.logger.log(`Signed in at ${args.loginUrl} -> ${landedOn} (${evidence})`);
      return { storageState, landedOn, evidence, durationMs: Date.now() - started };
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  /**
   * Decide whether the sign-in actually worked.
   *
   * Being wrong in the optimistic direction is the expensive mistake: a run that
   * believes it is authenticated but is not will plan a full suite against a
   * login page and then blame the application for every failure.
   */
  private async verify(page: Page, loginUrl: string, landedOn: string): Promise<string> {
    const movedAway = normaliseUrl(landedOn) !== normaliseUrl(loginUrl);

    // A visible error message is decisive, whether or not the URL changed.
    const errorText = await page
      .evaluate(() => {
        const NEEDLES = [
          /invalid/i,
          /incorrect/i,
          /wrong (password|username|email)/i,
          /not (match|found)/i,
          /try again/i,
          /failed to (log|sign) ?in/i,
          /unauthori[sz]ed/i,
        ];
        const nodes = Array.from(
          document.querySelectorAll('[role="alert"],.error,.alert,.invalid-feedback,p,span,div'),
        ).slice(0, 400);
        for (const el of nodes) {
          const txt = (el as HTMLElement).innerText?.trim() ?? '';
          if (!txt || txt.length > 200) continue;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') continue;
          if (NEEDLES.some((n) => n.test(txt))) return txt;
        }
        return '';
      })
      .catch(() => '');

    if (errorText) {
      throw new LoginFailedError(
        `The site rejected the sign-in: "${errorText.slice(0, 160)}"`,
        landedOn,
        'Check the test email and password. If they are correct, the account may be ' +
          'locked or require a second factor, which this platform cannot complete.',
      );
    }

    if (movedAway) {
      // Left the login page and said nothing bad. That is a sign-in.
      return `navigated from ${shortPath(loginUrl)} to ${shortPath(landedOn)}`;
    }

    // Same URL and no error. Common in single-page apps, where the password
    // field disappearing is the strongest signal available that the form is gone.
    const stillHasPassword = await page
      .locator('input[type="password"]:visible')
      .count()
      .then((n) => n > 0)
      .catch(() => true);

    if (!stillHasPassword) {
      return 'the sign-in form was replaced without navigating (single-page app)';
    }

    throw new LoginFailedError(
      'After submitting, the browser is still on the login page with the password ' +
        'field visible, and no error message was shown.',
      landedOn,
      'The submit button may have been the wrong one, or the form needs another field ' +
        '(a company code, a captcha, or a second factor). Setting the exact button ' +
        'label on the run removes the guesswork.',
    );
  }

  /**
   * Fill the first candidate label that resolves to a field of the right kind.
   *
   * The type check is not cosmetic. "Login" is a plausible label for a username
   * box, so it sits in the email candidates - but on a site where it matches a
   * password input instead, filling it would silently put the email into the
   * password box and the sign-in would fail with no clue why. Refusing the wrong
   * input type turns that into "we could not find the field", which is honest.
   */
  private async fillFirstMatch(
    page: Page,
    targets: string[],
    value: string,
    what: string,
    timeoutMs: number,
    want: 'password' | 'not-password',
  ): Promise<void> {
    // Short per-candidate timeout: most of these are expected to miss, and a
    // full timeout each would make signing in take minutes.
    const per = Math.max(1500, Math.floor(timeoutMs / targets.length));
    const skipped: string[] = [];

    for (const target of targets) {
      let locator;
      try {
        ({ locator } = await resolveLocator(page, target, 'field', per));
      } catch (err) {
        if (err instanceof LocatorNotFoundError) continue;
        throw err;
      }

      const type = await locator
        .first()
        .evaluate((el) => (el as HTMLInputElement).type?.toLowerCase() ?? '')
        .catch(() => '');
      const isPassword = type === 'password';
      if (want === 'password' ? !isPassword : isPassword) {
        skipped.push(
          `"${target}" matched a ${isPassword ? 'password' : type || 'non-password'} field`,
        );
        continue;
      }

      await locator.first().fill(value);

      // Confirm the value landed. A read-only or masked-but-controlled input can
      // accept a fill silently and keep its old value.
      const landed = await locator
        .first()
        .inputValue()
        .catch(() => '');
      if (landed !== value && !isPassword) {
        skipped.push(`"${target}" did not keep the value`);
        continue;
      }
      return;
    }

    throw new LoginFailedError(
      `Could not find ${what} on the login page. Tried: ${targets.join(', ')}.` +
        (skipped.length ? ` Rejected: ${skipped.join('; ')}.` : ''),
      page.url(),
      'Add a <label>, aria-label or placeholder to the field, or give its exact label ' +
        'when creating the run.',
    );
  }

  /**
   * Submit the sign-in form, and CONFIRM it actually submitted.
   *
   * Trusting the first label that resolves is not safe here. On a real login
   * page, the candidate "Log in" resolved by loose text match to the sentence
   * "This is where you can log into the secure area" - because "log in" is a
   * substring of "log into". The code clicked a heading, nothing happened, and
   * the run reported that sign-in had failed for mysterious reasons.
   *
   * So each attempt is checked for an effect (navigation, or the password field
   * disappearing) and the next candidate is tried when there was none. Genuine
   * submit controls are tried before any text matching, because a form's own
   * submit button is far better evidence than a matching word on the page.
   */
  private async submitForm(
    page: Page,
    explicitTargets: string[] | null,
    timeoutMs: number,
  ): Promise<void> {
    const before = await this.formState(page);
    const tried: string[] = [];

    const attempts: Array<{ label: string; run: () => Promise<void> }> = [];

    // 1. An exact label the user gave us. Their knowledge beats our guessing.
    if (explicitTargets) {
      for (const target of explicitTargets) {
        attempts.push({
          label: `label "${target}"`,
          run: async () => {
            const { locator } = await resolveLocator(page, target, 'clickable', 2500);
            await locator.click();
          },
        });
      }
    }

    // 2. The form's own submit control. Almost every login form has one, and it
    //    cannot be confused with prose.
    attempts.push({
      label: 'the form submit button',
      run: async () => {
        await page
          .locator('button[type="submit"], input[type="submit"]')
          .first()
          .click({ timeout: 4000 });
      },
    });

    // 3. Buttons by accessible name only - never free text, which is what
    //    matched a paragraph before.
    for (const name of SUBMIT_TARGETS) {
      attempts.push({
        label: `button named "${name}"`,
        run: async () => {
          await page.getByRole('button', { name, exact: false }).first().click({ timeout: 2500 });
        },
      });
    }

    // 4. Submit the form programmatically. Covers icon-only buttons with no
    //    accessible name at all.
    attempts.push({
      label: 'submitting the form directly',
      run: async () => {
        const ok = await page
          .locator('input[type="password"]')
          .first()
          .evaluate((el) => {
            const form = (el as HTMLInputElement).form;
            if (!form) return false;
            if (typeof form.requestSubmit === 'function') form.requestSubmit();
            else form.submit();
            return true;
          });
        if (!ok) throw new Error('the password field is not inside a form');
      },
    });

    for (const attempt of attempts) {
      try {
        await attempt.run();
      } catch {
        tried.push(`${attempt.label} (not found)`);
        continue;
      }

      if (await this.submissionTookEffect(page, before, timeoutMs)) return;
      tried.push(`${attempt.label} (clicked, nothing happened)`);
    }

    throw new LoginFailedError(
      'The sign-in form did not submit. Tried: ' + tried.join('; ') + '.',
      page.url(),
      'Give the exact label of the sign-in button when creating the run. If the form ' +
        'needs another field - a company code, a captcha, or a second factor - this ' +
        'platform cannot complete it.',
    );
  }

  /** Enough of the page state to tell whether a submit did anything. */
  private async formState(page: Page): Promise<{ url: string; passwordFields: number }> {
    return {
      url: page.url(),
      passwordFields: await page
        .locator('input[type="password"]:visible')
        .count()
        .catch(() => 0),
    };
  }

  /**
   * Did the submit do anything at all?
   *
   * Navigating away is the obvious signal. The password field disappearing
   * covers single-page apps that never change URL. An error message also counts
   * as an effect - the form was processed and rejected, which verify() will
   * report properly instead of us silently trying the next button.
   */
  private async submissionTookEffect(
    page: Page,
    before: { url: string; passwordFields: number },
    timeoutMs: number,
  ): Promise<boolean> {
    const deadline = Date.now() + Math.min(timeoutMs, 8000);
    for (;;) {
      const now = await this.formState(page).catch(() => before);
      if (normaliseUrl(now.url) !== normaliseUrl(before.url)) return true;
      if (now.passwordFields < before.passwordFields) return true;

      const errored = await page
        .locator('[role="alert"], .error, .alert, .flash, .invalid-feedback')
        .filter({ visible: true })
        .count()
        .then((n) => n > 0)
        .catch(() => false);
      if (errored) return true;

      if (Date.now() >= deadline) return false;
      await page.waitForTimeout(250);
    }
  }
}

/** A trailing slash or a hash change is not a page change. */
function normaliseUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = '';
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}${url.search}`;
  } catch {
    return u;
  }
}

function shortPath(u: string): string {
  try {
    return new URL(u).pathname || '/';
  } catch {
    return u;
  }
}
