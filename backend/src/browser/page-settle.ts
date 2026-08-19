import type { Page } from 'playwright';

/**
 * WAITING FOR A CLIENT-RENDERED APP TO PAINT.
 *
 * A Next.js / React app serves an empty shell, then renders the real UI after
 * hydration plus an auth check or data fetch. Looking during that window finds a
 * "Loading..." spinner and zero elements - which then gets misread as "the site
 * blocks automation" when in truth we simply looked too early.
 *
 * Shared by the scanner (before extracting structure) and the executor (after
 * every navigation), so both see the same page a human would.
 */

export interface SettleOptions {
  timeoutMs: number;
  pollMs: number;
  graceMs: number;
}

export interface SettleResult {
  settled: boolean;
  settleMs: number;
}

/**
 * Resolves when at least one visible interactive element exists, or when the
 * timeout expires. Never throws: a page that genuinely has no controls must
 * still be processable, with settled=false recorded as evidence.
 */
export async function waitForInteractiveContent(
  page: Page,
  opts: SettleOptions,
): Promise<SettleResult> {
  const t0 = Date.now();

  const settled = await page
    .waitForFunction(hasVisibleInteractiveElement, undefined, {
      timeout: opts.timeoutMs,
      polling: opts.pollMs,
    })
    .then(() => true)
    .catch(() => false);

  if (settled && opts.graceMs > 0) {
    // The first field appearing does not mean the last one has. Give the rest of
    // the form a moment so it is captured whole, not half-built.
    await page.waitForTimeout(opts.graceMs);
  }

  return { settled, settleMs: Date.now() - t0 };
}

/**
 * Runs INSIDE the browser, so it must be entirely self-contained.
 * Exported for reuse by the diagnostic script.
 */
export function hasVisibleInteractiveElement(): boolean {
  const isVisible = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = window.getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity || '1') > 0.05;
  };
  const candidates = document.querySelectorAll(
    'input:not([type="hidden"]), textarea, select, button, a[href], [role="button"]',
  );
  return Array.from(candidates).some(isVisible);
}
