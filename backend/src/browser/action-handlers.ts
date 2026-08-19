import { Page } from 'playwright';
import { ACTION_TARGET_KIND, TestStep } from '../common/test-plan.types';
import { resolveLocator } from './locator-resolver';
import { waitForInteractiveContent, type SettleOptions } from './page-settle';

/**
 * JSON -> REAL BROWSER ACTION.
 *
 * This is the "backend converts JSON into Playwright" layer. There is no AI
 * here and no dynamic code evaluation - just a switch over an allow-list. That
 * is what makes running model-authored tests safe: the model can only ask for
 * one of these ten things.
 */

export interface ActionContext {
  /** valueRef -> real secret. Decrypted only inside the worker. */
  values: Record<string, string>;
  /** Origin the run is allowed to touch, e.g. https://staging.example.com */
  baseOrigin: string;
  timeouts: { action: number; navigation: number };
  /** How long to wait after a navigation for the app to render its UI. */
  settle: SettleOptions;
}

export interface ActionOutcome {
  locatorStrategy?: string;
  message?: string;
}

/** Resolves the value a step should type, preferring the secret reference. */
export function resolveValue(step: TestStep, ctx: ActionContext): string {
  if (step.valueRef) {
    const v = ctx.values[step.valueRef];
    if (v === undefined) {
      throw new Error(
        `Step needs "${step.valueRef}" but no such credential was provided for this run.`,
      );
    }
    return v;
  }
  return step.value ?? '';
}

/** Turns a relative path into an absolute URL on the authorised origin. */
export function absoluteUrl(target: string, baseOrigin: string): string {
  if (target.startsWith('http://') || target.startsWith('https://')) return target;
  return new URL(target, baseOrigin).toString();
}

export async function executeStep(
  page: Page,
  step: TestStep,
  ctx: ActionContext,
): Promise<ActionOutcome> {
  const kind = ACTION_TARGET_KIND[step.action];
  const { action: actionTimeout, navigation: navTimeout } = ctx.timeouts;

  switch (step.action) {
    case 'goto': {
      const url = absoluteUrl(step.target, ctx.baseOrigin);
      const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navTimeout });
      // Wait for the app to actually paint. Without this, every following step
      // races against hydration on a client-rendered app.
      const { settled, settleMs } = await waitForInteractiveContent(page, ctx.settle);
      return {
        message:
          `navigated to ${page.url()} (HTTP ${res?.status() ?? '?'})` +
          (settled ? `, UI ready after ${settleMs}ms` : `, no UI after ${settleMs}ms`),
      };
    }

    case 'click': {
      const { locator, strategy } = await resolveLocator(page, step.target, 'clickable', actionTimeout);
      await locator.click({ timeout: actionTimeout });
      return { locatorStrategy: strategy, message: 'clicked' };
    }

    case 'hover': {
      const { locator, strategy } = await resolveLocator(page, step.target, 'clickable', actionTimeout);
      await locator.hover({ timeout: actionTimeout });
      return { locatorStrategy: strategy, message: 'hovered' };
    }

    case 'fill': {
      const { locator, strategy } = await resolveLocator(page, step.target, 'field', actionTimeout);
      const value = resolveValue(step, ctx);
      await locator.fill(value, { timeout: actionTimeout });
      return {
        locatorStrategy: strategy,
        // Never log the actual value - it may be a password.
        message: step.valueRef ? `filled from ${step.valueRef}` : `filled ${value.length} chars`,
      };
    }

    case 'select': {
      const { locator, strategy } = await resolveLocator(page, step.target, 'field', actionTimeout);
      const value = resolveValue(step, ctx);
      // Try by visible label first, then by value - sites use either.
      try {
        await locator.selectOption({ label: value }, { timeout: actionTimeout });
      } catch {
        await locator.selectOption(value, { timeout: actionTimeout });
      }
      return { locatorStrategy: strategy, message: `selected "${value}"` };
    }

    case 'check': {
      const { locator, strategy } = await resolveLocator(page, step.target, 'field', actionTimeout);
      await locator.check({ timeout: actionTimeout });
      return { locatorStrategy: strategy, message: 'checked' };
    }

    case 'uncheck': {
      const { locator, strategy } = await resolveLocator(page, step.target, 'field', actionTimeout);
      await locator.uncheck({ timeout: actionTimeout });
      return { locatorStrategy: strategy, message: 'unchecked' };
    }

    case 'press': {
      await page.keyboard.press(step.target);
      return { message: `pressed ${step.target}` };
    }

    case 'waitForUrl': {
      const fragment = step.value ?? step.target;
      await page.waitForURL((url) => url.toString().includes(fragment), { timeout: navTimeout });
      return { message: `url now contains "${fragment}"` };
    }

    case 'waitForVisible': {
      const { locator, strategy } = await resolveLocator(page, step.target, 'text', actionTimeout);
      await locator.waitFor({ state: 'visible', timeout: actionTimeout });
      return { locatorStrategy: strategy, message: 'became visible' };
    }

    default: {
      // Unreachable: the policy engine rejects unknown actions long before this.
      const never: never = step.action;
      throw new Error(`Unsupported action "${never}"`);
    }
  }
}
