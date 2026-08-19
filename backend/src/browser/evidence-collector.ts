import { Page, Request, Response } from 'playwright';
import type { CapturedConsole, CapturedRequest } from './browser.types';

/**
 * Attaches listeners that record what QA actually needs to debug a failure:
 * console errors, failed API calls, and page crashes.
 *
 * This is the difference between "test failed" and "test failed because the
 * login API returned 401".
 */
export class EvidenceCollector {
  readonly console: CapturedConsole[] = [];
  readonly network: CapturedRequest[] = [];
  private readonly requestStart = new Map<Request, number>();
  private static readonly MAX_ENTRIES = 300;

  /** Resource types we treat as "API calls" for the API-error list. */
  private static readonly API_TYPES = new Set(['xhr', 'fetch']);

  constructor(private readonly page: Page) {
    this.attach();
  }

  private attach() {
    this.page.on('console', (msg) => {
      const type = msg.type();
      const level =
        type === 'error' ? 'ERROR' : type === 'warning' ? 'WARNING' : type === 'debug' ? 'DEBUG' : 'INFO';
      // Only keep errors and warnings by default - info logs are noise and
      // would bloat both the database and the LLM prompt.
      if (level !== 'ERROR' && level !== 'WARNING') return;
      this.push(this.console, {
        level,
        message: msg.text().slice(0, 2000),
        location: msg.location()?.url
          ? `${msg.location().url}:${msg.location().lineNumber}`
          : undefined,
        at: new Date(),
      });
    });

    // Uncaught JS exceptions are console errors in spirit but a separate event.
    this.page.on('pageerror', (err) => {
      this.push(this.console, {
        level: 'ERROR',
        message: `Uncaught ${err.name}: ${err.message}`.slice(0, 2000),
        at: new Date(),
      });
    });

    this.page.on('request', (req) => this.requestStart.set(req, Date.now()));

    this.page.on('response', (res: Response) => {
      const req = res.request();
      const resourceType = req.resourceType();
      const status = res.status();
      const started = this.requestStart.get(req);
      const isApi = EvidenceCollector.API_TYPES.has(resourceType) || resourceType === 'document';

      // Record API traffic and anything that failed. Images and fonts that
      // succeed are not worth storing.
      if (!isApi && status < 400) return;

      this.push(this.network, {
        method: req.method(),
        url: res.url().slice(0, 2000),
        status,
        statusText: res.statusText(),
        resourceType,
        durationMs: started ? Date.now() - started : undefined,
        isApiError: status >= 400 && EvidenceCollector.API_TYPES.has(resourceType),
        at: new Date(),
      });
    });

    // A request that never got a response at all (DNS, TLS, connection reset).
    this.page.on('requestfailed', (req) => {
      const started = this.requestStart.get(req);
      this.push(this.network, {
        method: req.method(),
        url: req.url().slice(0, 2000),
        resourceType: req.resourceType(),
        failureText: req.failure()?.errorText ?? 'request failed',
        durationMs: started ? Date.now() - started : undefined,
        isApiError: EvidenceCollector.API_TYPES.has(req.resourceType()),
        at: new Date(),
      });
    });

    this.page.on('crash', () => {
      this.push(this.console, {
        level: 'ERROR',
        message: 'The page crashed (browser tab died).',
        at: new Date(),
      });
    });
  }

  /** Console errors only, as plain strings for the LLM prompt. */
  get consoleErrorTexts(): string[] {
    return this.console.filter((c) => c.level === 'ERROR').map((c) => c.message);
  }

  /** Failed API calls as plain strings for the LLM prompt and the UI. */
  get apiErrorTexts(): string[] {
    return this.network
      .filter((n) => n.isApiError || n.failureText)
      .map((n) =>
        n.failureText
          ? `${n.method} ${n.url} -> NETWORK FAILURE: ${n.failureText}`
          : `${n.method} ${n.url} -> ${n.status} ${n.statusText ?? ''}`.trim(),
      );
  }

  hasConsoleErrors() {
    return this.console.some((c) => c.level === 'ERROR');
  }

  hasApiErrors() {
    return this.network.some((n) => n.isApiError || Boolean(n.failureText));
  }

  private push<T>(arr: T[], item: T) {
    if (arr.length >= EvidenceCollector.MAX_ENTRIES) return;
    arr.push(item);
  }
}
