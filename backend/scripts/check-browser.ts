/**
 * Verifies Playwright + Chromium work, and shows what the page scanner sees.
 *
 *   npm run check:browser                       (defaults to example.com)
 *   npm run check:browser -- https://your.site/login
 *
 * Playwright needs no API key - it runs Chromium locally. If this fails, run:
 *   npx playwright install chromium
 */
import 'dotenv/config';
import { chromium } from 'playwright';

async function main() {
  const url = process.argv[2] ?? 'https://example.com';
  const headless = (process.env.BROWSER_HEADLESS ?? 'true') === 'true';

  console.log(`Opening ${url} (headless=${headless})\n`);

  const browser = await chromium.launch({ headless, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  const apiErrors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('response', (r) => {
    if (r.status() >= 400) apiErrors.push(`${r.request().method()} ${r.url()} -> ${r.status()}`);
  });
  page.on('requestfailed', (r) =>
    apiErrors.push(`${r.method()} ${r.url()} -> ${r.failure()?.errorText}`),
  );

  const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load').catch(() => undefined);

  // Same settle logic as PageScannerService, so this diagnostic reflects what
  // the real scan will see rather than a snapshot taken too early.
  const settleTimeout = Number(process.env.SCAN_SETTLE_TIMEOUT_MS ?? 15000);
  const t0 = Date.now();
  const settled = await page
    .waitForFunction(
      () => {
        const isVisible = (el: Element) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) return false;
          const s = window.getComputedStyle(el);
          return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity || '1') > 0.05;
        };
        const c = document.querySelectorAll(
          'input:not([type="hidden"]), textarea, select, button, a[href], [role="button"]',
        );
        return Array.from(c).some(isVisible);
      },
      undefined,
      { timeout: settleTimeout, polling: 250 },
    )
    .then(() => true)
    .catch(() => false);
  await page.waitForTimeout(700);

  console.log(
    settled
      ? `Interactive content appeared after ${Date.now() - t0}ms\n`
      : `WARNING: no interactive content after ${Date.now() - t0}ms. ` +
          'The app may render very late - raise SCAN_SETTLE_TIMEOUT_MS.\n',
  );

  console.log(`HTTP status : ${response?.status()}`);
  console.log(`Title       : ${await page.title()}`);
  console.log(`Final URL   : ${page.url()}\n`);

  // A miniature version of what PageScannerService extracts.
  const found = await page.evaluate(() => {
    const vis = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 || r.height > 0;
    };
    const label = (el: Element) =>
      el.getAttribute('aria-label') ||
      el.getAttribute('placeholder') ||
      el.getAttribute('name') ||
      (el as HTMLElement).innerText?.trim() ||
      '';

    return {
      inputs: Array.from(document.querySelectorAll('input, textarea, select'))
        .filter(vis)
        .map((e) => `${e.tagName.toLowerCase()}[${(e as HTMLInputElement).type ?? ''}] "${label(e)}"`)
        .slice(0, 30),
      buttons: Array.from(document.querySelectorAll('button, input[type=submit], [role=button]'))
        .filter(vis)
        .map((e) => `"${label(e)}"`)
        .slice(0, 30),
      links: Array.from(document.querySelectorAll('a[href]'))
        .filter(vis)
        .map((e) => `"${label(e)}" -> ${e.getAttribute('href')}`)
        .slice(0, 20),
    };
  });

  const show = (title: string, items: string[]) => {
    console.log(`${title} (${items.length})`);
    for (const i of items) console.log(`  - ${i}`);
    console.log('');
  };

  show('FIELDS', found.inputs);
  show('BUTTONS', found.buttons);
  show('LINKS', found.links);
  show('CONSOLE ERRORS', consoleErrors);
  show('FAILED REQUESTS', apiErrors);

  await page.screenshot({ path: 'check-browser.png', fullPage: true });
  console.log('Screenshot written to backend/check-browser.png');

  await browser.close();
  console.log('\nPlaywright is ready.');
}

void main().catch((err) => {
  console.error(`\nFAILED: ${(err as Error).message}`);
  console.error('If Chromium is missing, run:  npx playwright install chromium');
  process.exit(1);
});
