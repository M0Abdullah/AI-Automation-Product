/**
 * THE CONTRACT.
 *
 * This file is the single source of truth for what a test case may contain.
 * The LLM schema, the policy engine and the Playwright executor all import
 * from here, so the three can never drift apart.
 *
 * Adding a new capability = add it here, add a handler in
 * browser/action-handlers.ts (or assertion-handlers.ts), done.
 */

/** Actions the browser worker knows how to perform. Anything else is rejected. */
export const ALLOWED_ACTIONS = [
  'goto', // navigate to a path or URL on the allowed origin
  'click', // click a button / link / element
  'fill', // type into an input or textarea
  'select', // choose an option in a <select>
  'check', // tick a checkbox / radio
  'uncheck', // untick a checkbox
  'press', // press a keyboard key (Enter, Tab, Escape)
  'hover', // hover an element
  'waitForUrl', // wait until the URL contains a value
  'waitForVisible', // wait until an element becomes visible
] as const;

export type ActionName = (typeof ALLOWED_ACTIONS)[number];

/** Assertion types. These, and only these, decide PASS or FAIL. */
export const ALLOWED_ASSERTIONS = [
  'urlContains',
  'urlNotContains',
  'visible',
  'notVisible',
  'textContains',
  'textNotContains',
  'valueEquals',
  'titleContains',
  'elementCountAtLeast',
  'noConsoleErrors', // no console error was logged during the test
  'noApiErrors', // no xhr/fetch request returned 4xx/5xx
] as const;

export type AssertionType = (typeof ALLOWED_ASSERTIONS)[number];

/** Which actions need a value, and whether that value may be a secret ref. */
export const ACTION_VALUE_RULES: Record<ActionName, 'required' | 'optional' | 'none'> = {
  goto: 'none',
  click: 'none',
  fill: 'required',
  select: 'required',
  check: 'none',
  uncheck: 'none',
  press: 'none',
  hover: 'none',
  waitForUrl: 'none',
  waitForVisible: 'none',
};

/**
 * Which fields each assertion genuinely needs.
 *
 * This exists because an assertion missing its expected value is worse than no
 * assertion at all: `valueEquals` with no `value` compares the field against an
 * empty string and reports a confident, wrong FAIL. Requiring the field up front
 * turns a false bug report into a clear, explained rejection.
 */
export const ASSERTION_REQUIREMENTS: Record<
  AssertionType,
  { target: 'required' | 'optional' | 'none'; value: 'required' | 'optional' | 'none' }
> = {
  urlContains: { target: 'none', value: 'required' },
  urlNotContains: { target: 'none', value: 'required' },
  titleContains: { target: 'none', value: 'required' },
  visible: { target: 'required', value: 'none' },
  notVisible: { target: 'required', value: 'none' },
  // Target is optional: with one it checks inside that element, without one it
  // checks the whole page.
  textContains: { target: 'optional', value: 'required' },
  textNotContains: { target: 'optional', value: 'required' },
  valueEquals: { target: 'required', value: 'required' },
  elementCountAtLeast: { target: 'required', value: 'required' },
  // Whole-page checks - they read the evidence collector, not the DOM.
  noConsoleErrors: { target: 'none', value: 'none' },
  noApiErrors: { target: 'none', value: 'none' },
};

/** What kind of element the action targets — drives the locator strategy. */
export const ACTION_TARGET_KIND: Record<ActionName, 'field' | 'clickable' | 'text' | 'url' | 'key'> =
  {
    goto: 'url',
    click: 'clickable',
    fill: 'field',
    select: 'field',
    check: 'field',
    uncheck: 'field',
    press: 'key',
    hover: 'clickable',
    waitForUrl: 'url',
    waitForVisible: 'text',
  };

export interface TestStep {
  action: ActionName;
  /** Human-visible label, button text, path, or key name. */
  target: string;
  /** Reference to a stored secret, e.g. "test_email". Never a real value. */
  valueRef?: string;
  /** Literal, non-secret value (e.g. a search term or a <select> option). */
  value?: string;
  /** One line explaining the step, shown in the UI. */
  description?: string;
}

export interface TestAssertion {
  type: AssertionType;
  target?: string;
  value?: string;
  description?: string;
}

export interface TestCasePlan {
  title: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  requirement?: string;
  rationale?: string;
  tags?: string[];
  steps: TestStep[];
  assertions: TestAssertion[];
  destructive?: boolean;
}

/** Outcome of one executed step, stored on the result as evidence. */
export interface StepResult {
  index: number;
  action: string;
  target: string;
  status: 'passed' | 'failed' | 'skipped';
  /** Which locator strategy actually matched — invaluable when debugging. */
  locatorStrategy?: string;
  durationMs: number;
  message?: string;
}

/** Outcome of one assertion. */
export interface AssertionResult {
  index: number;
  type: string;
  target?: string;
  expected?: string;
  actual?: string;
  status: 'passed' | 'failed' | 'skipped';
  message?: string;
}

export type ErrorType =
  | 'LOCATOR_NOT_FOUND'
  | 'ASSERTION_FAILED'
  | 'TIMEOUT'
  | 'NAVIGATION'
  | 'PAGE_CRASH'
  | 'POLICY_BLOCKED'
  | 'UNKNOWN';
