import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { BrowserFactory } from './browser.factory';
import { EvidenceCollector } from './evidence-collector';
import { waitForInteractiveContent } from './page-settle';
import type { PageSnapshot, ScannedElement, ScannedForm } from './browser.types';

/**
 * STEP 1 OF THE PIPELINE: give the LLM eyes.
 *
 * The model cannot see a website. So Playwright opens the page and extracts a
 * compact, structured description of everything a user could interact with.
 * That description - and nothing else about the page - is what the model plans
 * against, which is why it can produce locators that actually work.
 *
 * Deliberately read-only: it navigates and looks. It never submits a form,
 * never clicks anything, never follows links.
 */
@Injectable()
export class PageScannerService {
  private readonly logger = new Logger(PageScannerService.name);

  constructor(
    private readonly browsers: BrowserFactory,
    private readonly config: AppConfigService,
  ) {}

  async scan(url: string): Promise<PageSnapshot> {
    const started = Date.now();
    const context = await this.browsers.newContext();
    const page = await context.newPage();
    const evidence = new EvidenceCollector(page);

    try {
      this.logger.log(`Scanning ${url}`);
      const response = await page.goto(url, { waitUntil: 'domcontentloaded' });

      // We deliberately do NOT wait for networkidle: analytics beacons, polling
      // and websockets keep real sites "busy" forever.
      await page
        .waitForLoadState('load', { timeout: this.config.browser.navigationTimeout })
        .catch(() => undefined);

      const { settled, settleMs } = await waitForInteractiveContent(page, {
        timeoutMs: this.config.browser.settleTimeout,
        pollMs: this.config.browser.settlePoll,
        graceMs: this.config.browser.settleGrace,
      });

      const max = this.config.browser.scanMaxElements;
      const extracted = await page.evaluate(extractPageStructure, max);

      const snapshot: PageSnapshot = {
        url,
        finalUrl: page.url(),
        title: await page.title(),
        httpStatus: response?.status() ?? null,
        headings: extracted.headings,
        elements: extracted.elements as unknown as ScannedElement[],
        forms: extracted.forms as unknown as ScannedForm[],
        visibleTextSample: extracted.visibleTextSample,
        consoleErrors: evidence.consoleErrorTexts.slice(0, 20),
        failedRequests: evidence.apiErrorTexts.slice(0, 20),
        scannedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        truncated: extracted.truncated,
        settled,
        settleMs,
      };

      this.logger.log(
        `Scan complete: ${snapshot.elements.length} element(s), ` +
          `${snapshot.consoleErrors.length} console error(s), ${snapshot.durationMs}ms ` +
          `(content ${settled ? `appeared after ${settleMs}ms` : `never appeared, waited ${settleMs}ms`})`,
      );
      return snapshot;
    } finally {
      await page.close().catch(() => undefined);
      await context.close().catch(() => undefined);
    }
  }

}

/**
 * Runs INSIDE the browser. Cannot reference anything from the Node scope, so it
 * is entirely self-contained and receives its limit as an argument.
 */
/* istanbul ignore next - executed in the browser, not in Node */
function extractPageStructure(maxElements: number) {
  const isVisible = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = window.getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity || '1') > 0.05;
  };

  const text = (el: Element | null): string =>
    ((el as HTMLElement)?.innerText ?? el?.textContent ?? '').replace(/\s+/g, ' ').trim();

  /** Best available human label, plus where it came from. */
  const labelOf = (el: Element): { label: string; source: string } => {
    const aria = el.getAttribute('aria-label');
    if (aria?.trim()) return { label: aria.trim(), source: 'aria-label' };

    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const joined = labelledBy
        .split(/\s+/)
        .map((id) => text(document.getElementById(id)))
        .filter(Boolean)
        .join(' ');
      if (joined) return { label: joined, source: 'label-for' };
    }

    const id = el.getAttribute('id');
    if (id) {
      const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id;
      const lbl = document.querySelector(`label[for="${escaped}"]`);
      if (lbl && text(lbl)) return { label: text(lbl), source: 'label-for' };
    }

    const wrapping = el.closest('label');
    if (wrapping && text(wrapping)) return { label: text(wrapping), source: 'wrapping-label' };

    const ph = el.getAttribute('placeholder');
    if (ph?.trim()) return { label: ph.trim(), source: 'placeholder' };

    const name = el.getAttribute('name');
    if (name?.trim()) return { label: name.trim(), source: 'name' };

    return { label: '', source: 'text' };
  };

  const elements: Array<Record<string, unknown>> = [];
  let truncated = false;

  const add = (item: Record<string, unknown>) => {
    if (elements.length >= maxElements) {
      truncated = true;
      return;
    }
    if (!item.label) return; // an unlabelled control is not addressable by name
    elements.push(item);
  };

  // --- inputs / textareas ---
  document.querySelectorAll('input, textarea').forEach((el) => {
    if (!isVisible(el)) return;
    const input = el as HTMLInputElement;
    const type = (input.type || 'text').toLowerCase();
    if (['hidden', 'submit', 'button', 'image', 'reset'].includes(type)) return;

    const { label, source } = labelOf(el);
    const kind =
      type === 'checkbox'
        ? 'checkbox'
        : type === 'radio'
          ? 'radio'
          : el.tagName.toLowerCase() === 'textarea'
            ? 'textarea'
            : 'input';

    add({
      kind,
      label,
      type,
      placeholder: input.placeholder || undefined,
      required: input.required || el.getAttribute('aria-required') === 'true' || undefined,
      labelSource: source,
    });
  });

  // --- selects ---
  document.querySelectorAll('select').forEach((el) => {
    if (!isVisible(el)) return;
    const { label, source } = labelOf(el);
    add({
      kind: 'select',
      label,
      options: Array.from((el as HTMLSelectElement).options)
        .slice(0, 20)
        .map((o) => o.label || o.value)
        .filter(Boolean),
      labelSource: source,
    });
  });

  // --- buttons (including submit inputs and role=button) ---
  document
    .querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]')
    .forEach((el) => {
      if (!isVisible(el)) return;
      const asInput = el as HTMLInputElement;
      const label =
        text(el) || asInput.value || el.getAttribute('aria-label') || el.getAttribute('title') || '';
      add({ kind: 'button', label: label.replace(/\s+/g, ' ').trim(), labelSource: 'text' });
    });

  // --- links ---
  document.querySelectorAll('a[href]').forEach((el) => {
    if (!isVisible(el)) return;
    const label = text(el) || el.getAttribute('aria-label') || '';
    const href = el.getAttribute('href') ?? '';
    if (href.startsWith('javascript:')) return;
    add({ kind: 'link', label, href: href.slice(0, 300), labelSource: 'text' });
  });

  // --- forms ---
  const forms = Array.from(document.querySelectorAll('form'))
    .slice(0, 10)
    .map((f) => ({
      method: (f.getAttribute('method') || 'get').toUpperCase(),
      action: (f.getAttribute('action') || '(same page)').slice(0, 300),
      fields: Array.from(f.querySelectorAll('input, select, textarea'))
        .map((i) => i.getAttribute('name') || i.getAttribute('id') || '')
        .filter(Boolean)
        .slice(0, 25),
    }));

  // --- headings ---
  const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
    .filter(isVisible)
    .map((h) => text(h))
    .filter(Boolean)
    .slice(0, 20);

  // A short text sample helps the model understand the page purpose, and lets
  // textContains assertions reference real on-page wording.
  const visibleTextSample = (document.body?.innerText ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200);

  // De-duplicate: the same button often matches several of our queries.
  const seen = new Set<string>();
  const deduped = elements.filter((e) => {
    const key = `${e.kind}::${String(e.label).toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { elements: deduped, forms, headings, visibleTextSample, truncated };
}
