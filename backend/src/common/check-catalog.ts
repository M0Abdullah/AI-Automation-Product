/**
 * THE CHECK CATALOGUE.
 *
 * Requirements in free text are powerful but unforgiving: write "test the login
 * page" and you get three tests that only confirm the fields exist. Most of what
 * a QA engineer wants checked is the same on every page anyway — does it load,
 * does it error, do the forms validate.
 *
 * So those become tickable checks. The user selects them, and the prompt turns
 * each one into a precise instruction. Free-text requirements stay for the things
 * only you know: your business rules.
 *
 * ONE source of truth: the frontend fetches this list from /api/capabilities, so
 * a check can never exist in the UI without an instruction behind it.
 */

export interface CheckDefinition {
  id: string;
  /** Shown as the checkbox label. */
  label: string;
  /** One line under the label, explaining what it actually verifies. */
  description: string;
  /** Grouping in the UI. */
  group: 'Basics' | 'Forms' | 'Navigation' | 'Login' | 'Data & Loading' | 'Content';
  /** Ticked by default — the cheap, universally useful ones. */
  defaultOn: boolean;
  /** Hidden/disabled unless the run has test credentials. */
  requiresCredentials?: boolean;
  /** The instruction handed to the model. Must be concrete about assertions. */
  instruction: string;
}

export const CHECK_CATALOG: CheckDefinition[] = [
  // Basics
  {
    id: 'page_loads',
    label: 'Page loads correctly',
    description: 'The page opens and has a real title',
    group: 'Basics',
    defaultOn: true,
    instruction:
      'Add one case that goes to the page and asserts titleContains with a distinctive word ' +
      'from the real page title, plus urlContains with the path. Use the title from PAGE SCAN.',
  },
  {
    id: 'no_console_errors',
    label: 'No JavaScript errors',
    description: 'Nothing broken in the browser console',
    group: 'Basics',
    defaultOn: true,
    instruction:
      'Add one case that opens the page and asserts noConsoleErrors. Do not combine it with ' +
      'other assertions, so a console error is reported on its own and not confused with a ' +
      'different failure.',
  },
  {
    id: 'no_api_errors',
    label: 'No broken API calls',
    description: 'No request returns 4xx or 5xx',
    group: 'Basics',
    defaultOn: true,
    instruction:
      'Add one case that opens the page and asserts noApiErrors, with no other assertions.',
  },
  {
    id: 'key_content_visible',
    label: 'Main content is visible',
    description: 'Headings and important text actually render',
    group: 'Basics',
    defaultOn: true,
    instruction:
      'Add one case asserting visible for the two or three most important headings from ' +
      'HEADINGS in PAGE SCAN. Do not assert more than four elements in one case.',
  },

  // Forms
  {
    id: 'fields_accept_input',
    label: 'Fields accept typing',
    description: 'Every input can be typed into and keeps its value',
    group: 'Forms',
    defaultOn: true,
    instruction:
      'For each non-password input field in PAGE SCAN, add a case that fills it with a ' +
      'plausible literal value and asserts valueEquals with that exact same value. Never use ' +
      'valueEquals on a field filled from a valueRef, because the expected value would be a secret.',
  },
  {
    id: 'required_validation',
    label: 'Required-field validation',
    description: 'Submitting an empty form shows a message',
    group: 'Forms',
    defaultOn: true,
    instruction:
      'Add one case that clicks the primary submit button with all fields left empty, then ' +
      'asserts urlContains with the current path (the user should NOT be navigated away). Only ' +
      'assert a specific error text if the REQUIREMENTS state what that text is.',
  },
  {
    id: 'email_format_validation',
    label: 'Email format is checked',
    description: 'A value like "abc" is rejected',
    group: 'Forms',
    defaultOn: false,
    instruction:
      'If an email-type field exists, add a case that fills it with "not-an-email", submits, ' +
      'and asserts urlContains with the current path so the user stays put. Skip this check ' +
      'entirely if no email field exists.',
  },

  // Navigation
  {
    id: 'links_work',
    label: 'Links go to the right place',
    description: 'Each link navigates instead of dead-ending',
    group: 'Navigation',
    defaultOn: false,
    instruction:
      'For up to three internal links in PAGE SCAN (href starting with /), add a case that ' +
      'clicks the link and asserts urlContains with that href. Skip external links.',
  },
  {
    id: 'buttons_dont_crash',
    label: 'Buttons do not break the page',
    description: 'Clicking a button leaves the page working',
    group: 'Navigation',
    defaultOn: false,
    instruction:
      'For up to two non-destructive buttons, add a case that clicks the button and then ' +
      'asserts noConsoleErrors. Never pick a button whose text suggests delete, pay or send.',
  },

  // Login
  {
    id: 'login_success',
    label: 'Login works',
    description: 'The test account can sign in',
    group: 'Login',
    defaultOn: false,
    requiresCredentials: true,
    instruction:
      'Add one P0 case that fills the email/username field with valueRef test_email, the ' +
      'password field with valueRef test_password, clicks the sign-in button, and then asserts ' +
      'ONLY what the REQUIREMENTS say happens next. If the requirements do not say, assert ' +
      'urlNotContains with the login path — leaving the login page is the weakest safe claim.',
  },
  {
    id: 'login_wrong_password',
    label: 'Wrong password is rejected',
    description: 'A bad password does not let you in',
    group: 'Login',
    defaultOn: false,
    requiresCredentials: true,
    instruction:
      'Add one case that fills the email field with valueRef test_email, fills the password ' +
      'field with the literal value "definitely-the-wrong-password", submits, and asserts ' +
      'urlContains with the login path so the user is still on the login page. Only assert ' +
      'specific error wording if the REQUIREMENTS state it.',
  },

  // Data & loading states
  {
    id: 'no_stuck_loader',
    label: 'Loading finishes properly',
    description: 'No spinner or skeleton is left on screen',
    group: 'Data & Loading',
    defaultOn: true,
    instruction:
      'Add one case that goes to the page and asserts noStuckLoader with no target. ' +
      'This catches a spinner or skeleton that never resolves - the page technically ' +
      'loaded, so no other assertion would notice. If the PAGE SCAN shows a distinct ' +
      'content area, add a second case scoping noStuckLoader to that area by target.',
  },
  {
    id: 'api_data_rendered',
    label: 'Server data is displayed',
    description: 'Values the API returns actually appear on the page',
    group: 'Data & Loading',
    defaultOn: false,
    instruction:
      'Add one or two cases asserting apiDataRendered. Set value to the JSON field name ' +
      'you expect the page to display, chosen from the requirement or from field labels in ' +
      'PAGE SCAN (for example "email", "name", "total"). Use a plain field name or a dotted ' +
      'path. Optionally set target to the element that should show it. Do NOT guess field ' +
      'names that have no basis in the scan or the requirement - a wrong field name produces ' +
      'a useless failure. If you cannot identify a real field, skip this check entirely.',
  },
];

const BY_ID = new Map(CHECK_CATALOG.map((c) => [c.id, c]));

/** Filters submitted ids to real ones. Unknown ids are ignored, never trusted. */
export function resolveChecks(ids: string[]): CheckDefinition[] {
  return ids.map((id) => BY_ID.get(id)).filter((c): c is CheckDefinition => Boolean(c));
}

export const DEFAULT_CHECK_IDS = CHECK_CATALOG.filter((c) => c.defaultOn).map((c) => c.id);

/**
 * WHICH CHECKS APPLY TO THIS PARTICULAR PAGE.
 *
 * Necessary as soon as a run covers a whole app rather than one screen. The
 * user ticks "Login works" once, meaning "check that my app's login works" -
 * but handing that instruction to all twelve pages would produce eleven test
 * cases that hunt for a password field on the dashboard, fail with
 * LOCATOR_NOT_FOUND, and fill the findings list with test defects. That is
 * precisely the false-bug noise this platform exists to avoid, so the filtering
 * happens here rather than being left to the model's judgement.
 *
 * Only the Login group is page-specific. Everything else - does it load, is the
 * console clean, do the fields accept typing - is genuinely true of every page.
 */
export function checksForPage(args: {
  checks: CheckDefinition[];
  hasCredentials: boolean;
  /** The page's final URL. */
  url: string;
  /** The page's title. */
  title: string;
  /** Did the scan find a password input? The strongest signal of the three. */
  hasPasswordField: boolean;
}): CheckDefinition[] {
  const { checks, hasCredentials, url, title, hasPasswordField } = args;

  // A password field is proof. The URL and title are corroboration for the apps
  // that render the field late or hide it behind a "continue" step.
  const looksLikeSignIn =
    hasPasswordField ||
    /(^|[^a-z])(login|log-in|signin|sign-in|auth)([^a-z]|$)/i.test(`${url} ${title}`);

  return checks.filter((c) => {
    // A credential-dependent check with no credentials would ask the model to
    // sign in with nothing.
    if (c.requiresCredentials && !hasCredentials) return false;
    if (c.group === 'Login') return looksLikeSignIn;
    return true;
  });
}
