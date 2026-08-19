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
