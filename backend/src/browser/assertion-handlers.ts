import { Page } from 'playwright';
import type { TestAssertion } from '../common/test-plan.types';
import { AssertionFailedError } from './browser.types';
import type { EvidenceCollector } from './evidence-collector';
import { resolveLocator } from './locator-resolver';

/**
 * WHERE PASS/FAIL IS DECIDED.
 *
 * Nothing else in this codebase may decide whether a test passed. Not the
 * model, not the backend, not a heuristic. Only these deterministic checks.
 *
 * Each handler either returns (pass) or throws AssertionFailedError carrying
 * expected vs actual, which is what the bug report needs.
 */

export interface AssertionContext {
  timeoutMs: number;
  evidence: EvidenceCollector;
}

export interface AssertionOutcome {
  expected: string;
  actual: string;
  message: string;
}

export async function runAssertion(
  page: Page,
  a: TestAssertion,
  ctx: AssertionContext,
): Promise<AssertionOutcome> {
  const { timeoutMs } = ctx;

  switch (a.type) {
    case 'urlContains': {
      const want = a.value ?? a.target ?? '';
      try {
        await page.waitForURL((u) => u.toString().includes(want), { timeout: timeoutMs });
      } catch {
        throw new AssertionFailedError(
          `URL should contain "${want}" but it is "${page.url()}"`,
          `url contains "${want}"`,
          page.url(),
        );
      }
      return { expected: `url contains "${want}"`, actual: page.url(), message: 'URL matched' };
    }

    case 'urlNotContains': {
      const want = a.value ?? a.target ?? '';
      const actual = page.url();
      if (actual.includes(want)) {
        throw new AssertionFailedError(
          `URL should NOT contain "${want}" but it is "${actual}"`,
          `url does not contain "${want}"`,
          actual,
        );
      }
      return { expected: `url does not contain "${want}"`, actual, message: 'URL matched' };
    }

    case 'titleContains': {
      const want = a.value ?? a.target ?? '';
      const actual = await page.title();
      if (!actual.toLowerCase().includes(want.toLowerCase())) {
        throw new AssertionFailedError(
          `Page title should contain "${want}" but it is "${actual}"`,
          `title contains "${want}"`,
          actual,
        );
      }
      return { expected: `title contains "${want}"`, actual, message: 'Title matched' };
    }

    case 'visible': {
      const target = a.target ?? a.value ?? '';
      try {
        const { locator, strategy } = await resolveLocator(page, target, 'text', timeoutMs);
        // waitFor auto-retries until the element is visible or the timeout hits,
        // which is what makes this robust against slow client-side rendering.
        await locator.waitFor({ state: 'visible', timeout: timeoutMs });
        return {
          expected: `"${target}" is visible`,
          actual: 'visible',
          message: `matched by ${strategy}`,
        };
      } catch (err) {
        throw new AssertionFailedError(
          `Expected "${target}" to be visible on the page, but it was not found or not visible.`,
          `"${target}" is visible`,
          'not visible / not present',
        );
      }
    }

    case 'notVisible': {
      const target = a.target ?? a.value ?? '';
      try {
        const { locator } = await resolveLocator(page, target, 'text', Math.min(timeoutMs, 3000));
        const visible = await locator.isVisible().catch(() => false);
        if (visible) {
          throw new AssertionFailedError(
            `Expected "${target}" to be hidden, but it is visible.`,
            `"${target}" is not visible`,
            'visible',
          );
        }
      } catch (err) {
        if (err instanceof AssertionFailedError) throw err;
        // Not found at all is a pass for notVisible.
      }
      return {
        expected: `"${target}" is not visible`,
        actual: 'not visible',
        message: 'Element absent or hidden',
      };
    }

    case 'textContains': {
      const want = a.value ?? '';
      // If a target is given, check inside that element; otherwise whole page.
      if (a.target) {
        const { locator, strategy } = await resolveLocator(page, a.target, 'text', timeoutMs);
        const actual = (await locator.innerText().catch(() => '')) || '';
        if (!actual.toLowerCase().includes(want.toLowerCase())) {
          throw new AssertionFailedError(
            `"${a.target}" should contain "${want}" but contains "${truncate(actual)}"`,
            `contains "${want}"`,
            truncate(actual),
          );
        }
        return { expected: `contains "${want}"`, actual: truncate(actual), message: `via ${strategy}` };
      }

      const body = (await page.locator('body').innerText().catch(() => '')) || '';
      if (!body.toLowerCase().includes(want.toLowerCase())) {
        throw new AssertionFailedError(
          `Page should contain the text "${want}" but it does not.`,
          `page contains "${want}"`,
          'text not found on page',
        );
      }
      return {
        expected: `page contains "${want}"`,
        actual: 'found',
        message: 'Text found on page',
      };
    }

    case 'textNotContains': {
      const want = a.value ?? '';
      const scope = a.target ? (await resolveLocator(page, a.target, 'text', timeoutMs)).locator : page.locator('body');
      const actual = (await scope.innerText().catch(() => '')) || '';
      if (actual.toLowerCase().includes(want.toLowerCase())) {
        throw new AssertionFailedError(
          `Text "${want}" should NOT be present, but it is.`,
          `does not contain "${want}"`,
          truncate(actual),
        );
      }
      return { expected: `does not contain "${want}"`, actual: 'absent', message: 'Text absent' };
    }

    case 'valueEquals': {
      const target = a.target ?? '';
      const want = a.value ?? '';
      const { locator, strategy } = await resolveLocator(page, target, 'field', timeoutMs);
      const actual = await locator.inputValue().catch(() => '');
      if (actual !== want) {
        throw new AssertionFailedError(
          `"${target}" should have value "${want}" but has "${actual}"`,
          want,
          actual,
        );
      }
      return { expected: want, actual, message: `via ${strategy}` };
    }

    case 'elementCountAtLeast': {
      const target = a.target ?? '';
      const min = Number(a.value ?? '1');
      const { locator, strategy } = await resolveLocator(page, target, 'text', timeoutMs);
      const count = await locator.count();
      if (count < min) {
        throw new AssertionFailedError(
          `Expected at least ${min} of "${target}" but found ${count}`,
          `>= ${min}`,
          String(count),
        );
      }
      return { expected: `>= ${min}`, actual: String(count), message: `via ${strategy}` };
    }

    case 'noConsoleErrors': {
      const errors = ctx.evidence.consoleErrorTexts;
      if (errors.length) {
        throw new AssertionFailedError(
          `Expected no console errors but found ${errors.length}. First: ${truncate(errors[0])}`,
          'no console errors',
          `${errors.length} console error(s)`,
        );
      }
      return { expected: 'no console errors', actual: 'none', message: 'Console clean' };
    }

    case 'noApiErrors': {
      const errors = ctx.evidence.apiErrorTexts;
      if (errors.length) {
        throw new AssertionFailedError(
          `Expected no failed API requests but found ${errors.length}. First: ${truncate(errors[0])}`,
          'no failed API requests',
          `${errors.length} failed request(s)`,
        );
      }
      return { expected: 'no failed API requests', actual: 'none', message: 'Network clean' };
    }

    /**
     * A spinner or skeleton that never goes away. Users read this as "the app is
     * broken", but every other assertion happily passes because the page did
     * load - so nothing caught it before this.
     *
     * The check is deliberately "still spinning after we waited", not "a spinner
     * appeared": a loader flashing during load is correct behaviour.
     */
    case 'noStuckLoader': {
      const scope = a.target?.trim();
      const deadline = Date.now() + timeoutMs;
      let last: { text: string; how: string } | null = null;

      for (;;) {
        last = await findVisibleLoader(page, scope);
        if (!last) {
          return {
            expected: 'no loading indicator left on screen',
            actual: 'none',
            message: scope ? `Checked inside "${scope}"` : 'Whole page checked',
          };
        }
        if (Date.now() >= deadline) break;
        await page.waitForTimeout(Math.min(250, Math.max(0, deadline - Date.now())));
      }

      throw new AssertionFailedError(
        `A loading indicator was still visible after ${Math.round(timeoutMs / 1000)}s` +
          `${scope ? ` inside "${scope}"` : ''}. Matched by ${last.how}` +
          `${last.text ? `: "${truncate(last.text, 80)}"` : ''}. ` +
          'The page finished loading but something never resolved.',
        'no loading indicator left on screen',
        `still loading (${last.how})`,
      );
    }

    /**
     * DATA CORRECTNESS: does the page actually show what the server sent?
     *
     * Everything else in this file proves the request succeeded. This proves the
     * response was rendered. A 200 that paints a blank field or a stale value is
     * invisible to every other check.
     *
     * `value` is the JSON field to look for ("email", or "data.user.name").
     */
    case 'apiDataRendered': {
      const field = (a.value ?? '').trim();
      const bodies = ctx.evidence.jsonBodies;

      if (!bodies.length) {
        throw new AssertionFailedError(
          `Cannot check "${field}": no JSON API response was captured during this test. ` +
            'The page may render server-side, or the data call happened before the test started.',
          `an API response containing "${field}"`,
          'no JSON responses captured',
        );
      }

      // Newest first: on a page that refetches, the latest response is the one
      // on screen.
      let found: { value: string; url: string } | null = null;
      for (let i = bodies.length - 1; i >= 0 && !found; i--) {
        const hit = extractField(bodies[i].json, field);
        if (hit !== null) found = { value: hit, url: bodies[i].url };
      }

      if (!found) {
        throw new AssertionFailedError(
          `The field "${field}" was not present in any of the ${bodies.length} JSON ` +
            'response(s) captured. Check the field name against the real API payload.',
          `"${field}" present in an API response`,
          'field not found in any response',
        );
      }

      // An empty or null value proves nothing either way, so refuse to judge it
      // rather than reporting a confident wrong result.
      if (!found.value) {
        throw new AssertionFailedError(
          `The API returned "${field}" but it was empty, so there is nothing to look ` +
            'for on the page. This is usually a test-data problem, not a UI bug.',
          `a non-empty "${field}" from the API`,
          'empty value',
        );
      }

      const where = a.target?.trim();
      let haystack: string;
      let scopeLabel: string;
      if (where) {
        const { locator, strategy } = await resolveLocator(page, where, 'text', timeoutMs);
        haystack = (await locator.first().innerText().catch(() => '')) || '';
        scopeLabel = `inside "${where}" (${strategy})`;
      } else {
        haystack = await page.evaluate(() => document.body.innerText ?? '');
        scopeLabel = 'on the page';
      }

      if (!normalise(haystack).includes(normalise(found.value))) {
        throw new AssertionFailedError(
          `The API returned ${field}="${truncate(found.value, 80)}" (from ${found.url}) ` +
            `but that value is not displayed ${scopeLabel}. The request succeeded, ` +
            'so the data arrived and was not rendered.',
          `"${truncate(found.value, 60)}" shown ${scopeLabel}`,
          'not present in the rendered text',
        );
      }

      return {
        expected: `API ${field}="${truncate(found.value, 60)}" is displayed`,
        actual: 'displayed',
        message: `Matched ${scopeLabel} against ${found.url}`,
      };
    }

    default: {
      const never: never = a.type;
      throw new Error(`Unsupported assertion "${never}"`);
    }
  }
}

function truncate(s: string, n = 200): string {
  const flat = (s ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > n ? `${flat.slice(0, n)}...` : flat;
}

/** Compare rendered text loosely: whitespace and case differ constantly. */
function normalise(s: string): string {
  return (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Find a loading indicator that is CURRENTLY visible.
 *
 * There is no standard for "this is a spinner", so this uses the three signals
 * real apps actually ship: the ARIA contract, the near-universal class-name
 * vocabulary, and visible "Loading" text. Returning how it matched matters -
 * a failure that says "matched by aria-busy" is debuggable; "loader found" is not.
 */
async function findVisibleLoader(
  page: Page,
  scopeSelector?: string,
): Promise<{ text: string; how: string } | null> {
  return page.evaluate((scope) => {
    const root: ParentNode =
      (scope ? document.querySelector(scope) : null) ?? document;

    const onScreen = (el: Element): boolean => {
      const s = window.getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };

    // 1. The accessibility contract. Most reliable when present.
    for (const el of Array.from(root.querySelectorAll('[aria-busy="true"]'))) {
      if (onScreen(el)) return { text: '', how: 'aria-busy="true"' };
    }
    for (const el of Array.from(root.querySelectorAll('[role="progressbar"]'))) {
      if (onScreen(el)) return { text: '', how: 'role="progressbar"' };
    }

    // 2. Class-name vocabulary. Word-boundary matched so "download-loader-icon"
    //    hits but "reloaded" does not.
    const VOCAB = /(^|[^a-z])(spinner|loader|loading|skeleton|shimmer|placeholder-glow)([^a-z]|$)/i;
    for (const el of Array.from(root.querySelectorAll('[class]'))) {
      const cls = typeof el.className === 'string' ? el.className : '';
      if (VOCAB.test(cls) && onScreen(el)) {
        return { text: '', how: `class "${cls.slice(0, 60)}"` };
      }
    }

    // 3. Visible text, as a last resort. Only short strings, so an article about
    //    loading does not trip it.
    for (const el of Array.from(root.querySelectorAll('div,span,p,h1,h2,h3,td'))) {
      const txt = (el as HTMLElement).innerText?.trim() ?? '';
      if (!txt || txt.length > 30) continue;
      if (/^(loading|please wait|fetching)\b/i.test(txt) && onScreen(el)) {
        return { text: txt, how: 'visible loading text' };
      }
    }
    return null;
  }, scopeSelector ?? null);
}

/**
 * Pull one scalar out of a JSON response.
 *
 * Tries the dotted path first ("data.user.email"), then falls back to a
 * breadth-first hunt for the last path segment anywhere in the tree, because
 * real APIs wrap payloads in envelopes nobody documents ({data:{...}},
 * {result:{...}}, arrays of one). Returns null when absent, "" when present
 * but empty - the caller treats those differently on purpose.
 */
function extractField(json: unknown, field: string): string | null {
  const scalar = (v: unknown): string | null => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
    return null;
  };

  // --- exact dotted path
  let cur: unknown = json;
  for (const part of field.split('.')) {
    if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      cur = undefined;
      break;
    }
  }
  const direct = scalar(cur);
  if (direct !== null) return direct;

  // --- breadth-first search for the leaf key
  const leaf = field.split('.').pop() ?? field;
  const queue: unknown[] = [json];
  let guard = 0;
  while (queue.length && guard++ < 5000) {
    const node = queue.shift();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      queue.push(...node.slice(0, 50));
      continue;
    }
    const obj = node as Record<string, unknown>;
    if (leaf in obj) {
      const hit = scalar(obj[leaf]);
      if (hit !== null) return hit;
    }
    for (const v of Object.values(obj)) if (v && typeof v === 'object') queue.push(v);
  }
  return null;
}
