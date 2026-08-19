import { Locator, Page } from 'playwright';
import { LocatorNotFoundError } from './browser.types';

/**
 * TURNING A LABEL INTO A REAL ELEMENT.
 *
 * This file is where most real-world flakiness is won or lost. The LLM writes
 * target: "Email", but the page might use a placeholder, an aria-label, a name
 * attribute, or a heading above the field. So instead of one selector we try an
 * ordered list of strategies and use the first that matches exactly one visible
 * element.
 *
 * We also report WHICH strategy matched. When QA sees
 * "matched by: placeholder" they instantly understand why a locator was
 * fragile - far more useful than a bare timeout.
 */

export interface ResolvedLocator {
  locator: Locator;
  strategy: string;
}

interface Candidate {
  strategy: string;
  build: () => Locator;
}

const clean = (s: string) => s.trim().replace(/\s+/g, ' ');

/** Escapes a string for use inside a CSS attribute selector. */
const attr = (s: string) => s.replace(/"/g, '\\"');

function fieldCandidates(page: Page, target: string): Candidate[] {
  const t = clean(target);
  return [
    { strategy: 'label', build: () => page.getByLabel(t, { exact: true }) },
    { strategy: 'label(partial)', build: () => page.getByLabel(t, { exact: false }) },
    { strategy: 'placeholder', build: () => page.getByPlaceholder(t, { exact: false }) },
    { strategy: 'role=textbox[name]', build: () => page.getByRole('textbox', { name: t }) },
    { strategy: 'aria-label', build: () => page.locator(`[aria-label="${attr(t)}"]`) },
    { strategy: 'name attribute', build: () => page.locator(`[name="${attr(t)}"]`) },
    { strategy: 'id', build: () => page.locator(`#${cssId(t)}`) },
    { strategy: 'data-testid', build: () => page.getByTestId(t) },
    {
      strategy: 'name attribute (lowercased)',
      build: () => page.locator(`[name="${attr(t.toLowerCase().replace(/\s+/g, '_'))}"]`),
    },
    {
      strategy: 'type attribute',
      build: () => page.locator(`input[type="${attr(t.toLowerCase())}"]`),
    },
  ];
}

function clickableCandidates(page: Page, target: string): Candidate[] {
  const t = clean(target);
  return [
    { strategy: 'role=button[name]', build: () => page.getByRole('button', { name: t, exact: true }) },
    { strategy: 'role=link[name]', build: () => page.getByRole('link', { name: t, exact: true }) },
    {
      strategy: 'role=button[name](partial)',
      build: () => page.getByRole('button', { name: t, exact: false }),
    },
    {
      strategy: 'role=link[name](partial)',
      build: () => page.getByRole('link', { name: t, exact: false }),
    },
    { strategy: 'data-testid', build: () => page.getByTestId(t) },
    { strategy: 'aria-label', build: () => page.locator(`[aria-label="${attr(t)}"]`) },
    { strategy: 'input[value]', build: () => page.locator(`input[value="${attr(t)}"]`) },
    { strategy: 'text', build: () => page.getByText(t, { exact: false }) },
  ];
}

function textCandidates(page: Page, target: string): Candidate[] {
  const t = clean(target);
  return [
    { strategy: 'text(exact)', build: () => page.getByText(t, { exact: true }) },
    { strategy: 'text(partial)', build: () => page.getByText(t, { exact: false }) },
    { strategy: 'role=heading[name]', build: () => page.getByRole('heading', { name: t }) },
    { strategy: 'aria-label', build: () => page.locator(`[aria-label="${attr(t)}"]`) },
    { strategy: 'data-testid', build: () => page.getByTestId(t) },
    { strategy: 'role=button[name]', build: () => page.getByRole('button', { name: t }) },
    { strategy: 'role=link[name]', build: () => page.getByRole('link', { name: t }) },
  ];
}

/** Only used for #id selectors, which cannot contain spaces. */
function cssId(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '');
}

/** How often the whole candidate list is re-checked while waiting. */
const POLL_INTERVAL_MS = 200;

/**
 * Finds the element, WAITING for it to appear.
 *
 * The waiting matters more than the strategy list. `locator.count()` is an
 * instantaneous snapshot, so a single sweep of the candidates fails on any
 * client-rendered app: right after a navigation the DOM is still a loading
 * spinner and nothing matches yet. So the entire sweep is repeated on a poll
 * until the timeout - which is the auto-waiting behaviour Playwright's own
 * locators have, extended across our multiple strategies.
 *
 * Throws LocatorNotFoundError listing every strategy tried, which the executor
 * maps to a TEST_DEFECT signal rather than a product bug.
 */
export async function resolveLocator(
  page: Page,
  target: string,
  kind: 'field' | 'clickable' | 'text',
  timeoutMs: number,
): Promise<ResolvedLocator> {
  const candidates =
    kind === 'field'
      ? fieldCandidates(page, target)
      : kind === 'clickable'
        ? clickableCandidates(page, target)
        : textCandidates(page, target);

  const tried = new Set<string>();
  const deadline = Date.now() + timeoutMs;

  // Phase 1: keep sweeping for a VISIBLE match until the deadline.
  for (;;) {
    const hit = await sweep(candidates, tried, true);
    if (hit) return hit;
    if (Date.now() >= deadline) break;
    await page.waitForTimeout(Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
  }

  // Phase 2: last resort, accept a present-but-hidden match. Failing the
  // interaction with "element is not visible" is far more useful to QA than a
  // flat "not found", because it says the locator was right and the state wrong.
  const hidden = await sweep(candidates, tried, false);
  if (hidden) {
    return { locator: hidden.locator, strategy: `${hidden.strategy} (present but not visible)` };
  }

  throw new LocatorNotFoundError(target, [...tried]);
}

/** One pass over every strategy. Returns the first acceptable match. */
async function sweep(
  candidates: Candidate[],
  tried: Set<string>,
  requireVisible: boolean,
): Promise<ResolvedLocator | null> {
  for (const c of candidates) {
    tried.add(c.strategy);
    try {
      const loc = c.build();
      const count = await loc.count();
      if (count === 0) continue;

      // More than one match: take the first, but say so in the strategy name so
      // QA knows the locator was ambiguous.
      const chosen = count > 1 ? loc.first() : loc;
      if (requireVisible && !(await chosen.isVisible().catch(() => false))) continue;

      return {
        locator: chosen,
        strategy: count > 1 ? `${c.strategy} (first of ${count})` : c.strategy,
      };
    } catch {
      // An invalid selector for this particular target - try the next one.
      continue;
    }
  }
  return null;
}
