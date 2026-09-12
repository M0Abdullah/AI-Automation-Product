import { Injectable, Logger } from '@nestjs/common';
import type { Page } from 'playwright';
import { AppConfigService } from '../config/app-config.service';
import { BrowserFactory, type StorageState } from './browser.factory';
import { waitForInteractiveContent } from './page-settle';

/** One page the crawler decided belongs to the app under test. */
export interface DiscoveredPage {
  /** Normalised absolute URL — no hash, no trailing slash, no tracking params. */
  url: string;
  /** path + search, for a compact UI label. */
  path: string;
  /** The <title> as seen while crawling. Empty when the page had none. */
  title: string;
  /** The page whose link led here. Undefined for the entry URL. */
  discoveredFrom?: string;
  /** Link distance from the entry URL. The entry page is 0. */
  depth: number;
}

export interface CrawlOptions {
  entryUrl: string;
  maxPages: number;
  maxDepth: number;
  /** A discovered path must contain one of these. Empty = no restriction. */
  includePaths?: string[];
  /** A discovered path containing one of these is dropped. */
  excludePaths?: string[];
  storageState?: StorageState;
}

export interface CrawlResult {
  pages: DiscoveredPage[];
  /** Links seen and deliberately not crawled, with the reason. Surfaced in the UI. */
  skipped: Array<{ url: string; reason: string }>;
  /** True when the page budget ran out before the frontier was empty. */
  truncated: boolean;
  durationMs: number;
}

/**
 * PATHS NEVER CRAWLED, whatever the user configures.
 *
 * Signing out is the important one. The crawler reuses the run's session, so
 * following a "Log out" link would destroy it — and every page discovered after
 * that point would be the login screen, with the whole run then reporting that
 * the application is broken. Everything else here is either destructive or a
 * download rather than a page.
 */
const ALWAYS_EXCLUDED = [
  'logout',
  'log-out',
  'signout',
  'sign-out',
  'log_out',
  'sign_out',
  'delete',
  'remove',
  'destroy',
  'unsubscribe',
  'deactivate',
  'checkout',
  'payment',
  '/pay',
  'export',
  'download',
  'print',
];

/** Extensions that are files, not pages. Following them wastes the page budget. */
const ASSET_EXTENSIONS =
  /\.(png|jpe?g|gif|svg|webp|ico|bmp|avif|pdf|zip|gz|tar|rar|7z|csv|xlsx?|docx?|pptx?|mp[34]|wav|ogg|webm|mov|avi|woff2?|ttf|eot|otf|css|js|mjs|map|json|xml|rss|txt)$/i;

/** Query parameters that only ever produce a duplicate of the same page. */
const TRACKING_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
  'ref',
  'referrer',
  '_ga',
  'mc_cid',
  'mc_eid',
];

/**
 * STEP 0 OF A WHOLE-APP RUN: find out what the app actually is.
 *
 * The platform used to test one URL because one URL is what the user typed.
 * That made "test my app" into five separate runs with five separate approval
 * gates and five unrelated bug lists. This service turns the entry URL into the
 * set of pages the app is made of, and everything downstream — scan, plan,
 * execute, wording — then runs per page inside ONE run with one approval gate.
 *
 * WHAT IT IS NOT: a general web crawler. It is bounded on purpose, because
 * every extra page costs a browser scan and an LLM call:
 *
 *   * same origin only — the entry URL's origin, never a third-party link
 *   * breadth-first — the pages a user reaches in one click come before the
 *     ones buried four levels down, so a small budget spends itself on the
 *     screens that matter
 *   * read-only — it reads `href` attributes. It never clicks, never submits a
 *     form, and never follows a link that looks destructive
 *   * deduplicated by normalised URL, so `/users`, `/users/`, `/users#top` and
 *     `/users?utm_source=x` are one page rather than four
 *
 * It reuses the run's established sign-in, which is what makes an app's
 * interior discoverable at all: anonymously, a protected app is a login page
 * with no links on it.
 */
@Injectable()
export class SiteCrawlerService {
  private readonly logger = new Logger(SiteCrawlerService.name);

  constructor(
    private readonly browsers: BrowserFactory,
    private readonly config: AppConfigService,
  ) {}

  async crawl(options: CrawlOptions): Promise<CrawlResult> {
    const started = Date.now();
    const { entryUrl, maxPages, maxDepth } = options;

    const origin = new URL(entryUrl).origin;
    const entry = normaliseUrl(entryUrl);

    const pages: DiscoveredPage[] = [];
    const skipped: Array<{ url: string; reason: string }> = [];
    const seen = new Set<string>([entry]);

    // The entry page is page 1 unconditionally. It is what the user asked for,
    // so it is never dropped by a filter meant for discovered links.
    const frontier: DiscoveredPage[] = [{ url: entry, path: pathOf(entry), title: '', depth: 0 }];

    const context = await this.browsers.newContext(options.storageState);
    let truncated = false;

    try {
      while (frontier.length && pages.length < maxPages) {
        const current = frontier.shift()!;

        let harvest: { title: string; links: string[] };
        try {
          harvest = await this.readPage(context, current.url);
        } catch (err) {
          // A page that will not open is still a page of the app, and it is
          // useful evidence. It goes into the run so the scan phase records the
          // real reason against it rather than the crawler swallowing it.
          this.logger.warn(`Crawl could not open ${current.url}: ${msg(err)}`);
          pages.push(current);
          continue;
        }

        pages.push({ ...current, title: harvest.title });

        // Already at the depth limit: this page's own links are out of scope.
        if (current.depth >= maxDepth) continue;

        for (const raw of harvest.links) {
          if (seen.size > maxPages * 40) break; // runaway guard on link-heavy apps

          const candidate = this.classify(raw, origin, current.url, options);
          if (!candidate.ok) {
            // Record each distinct reason once. A nav bar repeats the same
            // rejected link on every page and a 200-line "skipped" list is noise.
            if (!seen.has(candidate.url)) {
              seen.add(candidate.url);
              if (skipped.length < 40)
                skipped.push({ url: candidate.url, reason: candidate.reason });
            }
            continue;
          }

          if (seen.has(candidate.url)) continue;
          seen.add(candidate.url);

          frontier.push({
            url: candidate.url,
            path: pathOf(candidate.url),
            title: '',
            discoveredFrom: current.url,
            depth: current.depth + 1,
          });
        }
      }

      truncated = frontier.length > 0;
      if (truncated) {
        // Say how many were left rather than dropping them silently — "we tested
        // 10 of 34 pages" is the honest framing, and it tells the user to raise
        // the budget.
        this.logger.log(
          `Crawl stopped at the ${maxPages}-page budget; ${frontier.length} more page(s) were queued`,
        );
      }
    } finally {
      await context.close().catch(() => undefined);
    }

    this.logger.log(
      `Crawled ${pages.length} page(s) from ${entryUrl} in ${Date.now() - started}ms ` +
        `(${skipped.length} link(s) skipped)`,
    );

    return { pages, skipped, truncated, durationMs: Date.now() - started };
  }

  /**
   * Opens one page and harvests its links.
   *
   * Waits for interactive content for the same reason the scanner does: a
   * client-rendered app serves an empty shell and paints the navigation after
   * hydration, so reading `href`s too early finds nothing and the crawl stops
   * at the entry page believing the app has one screen.
   */
  private async readPage(
    context: Awaited<ReturnType<BrowserFactory['newContext']>>,
    url: string,
  ): Promise<{ title: string; links: string[] }> {
    const page = await context.newPage();
    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: this.config.browser.navigationTimeout,
      });
      await waitForInteractiveContent(page, {
        timeoutMs: this.config.browser.settleTimeout,
        pollMs: this.config.browser.settlePoll,
        graceMs: this.config.browser.settleGrace,
      });
      const title = await page.title().catch(() => '');
      const links = await harvestLinks(page);
      return { title, links };
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  /**
   * Should this link become a page of the run?
   *
   * Returns the normalised URL either way, so a rejection can be reported with
   * the same identity the accepted pages use.
   */
  private classify(
    raw: string,
    origin: string,
    from: string,
    options: CrawlOptions,
  ): { ok: true; url: string } | { ok: false; url: string; reason: string } {
    let absolute: URL;
    try {
      absolute = new URL(raw, from);
    } catch {
      return { ok: false, url: raw.slice(0, 200), reason: 'Not a valid URL' };
    }

    if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') {
      return {
        ok: false,
        url: absolute.href.slice(0, 200),
        reason: `Not a web page (${absolute.protocol})`,
      };
    }

    const url = normaliseUrl(absolute.href);

    // SAME ORIGIN ONLY. The user authorised one site; following an outbound
    // link would point an automated browser at somebody who never consented.
    if (absolute.origin !== origin) {
      return { ok: false, url, reason: `Different site (${absolute.origin})` };
    }

    if (ASSET_EXTENSIONS.test(absolute.pathname)) {
      return { ok: false, url, reason: 'A file, not a page' };
    }

    const haystack = `${absolute.pathname}${absolute.search}`.toLowerCase();

    const banned = ALWAYS_EXCLUDED.find((w) => haystack.includes(w));
    if (banned) {
      return {
        ok: false,
        url,
        reason: banned.includes('out')
          ? "Signing out would destroy the run's session"
          : `Looks destructive ("${banned}")`,
      };
    }

    const excluded = options.excludePaths?.find((w) => w && haystack.includes(w.toLowerCase()));
    if (excluded) return { ok: false, url, reason: `Excluded by "${excluded}"` };

    const includes = options.includePaths?.filter(Boolean) ?? [];
    if (includes.length && !includes.some((w) => haystack.includes(w.toLowerCase()))) {
      return { ok: false, url, reason: 'Outside the included paths' };
    }

    return { ok: true, url };
  }
}

/**
 * Reads every `href` on the page, including inside open shadow roots.
 *
 * Anchors only, deliberately. A button that navigates via JavaScript is not
 * discoverable without clicking it, and clicking unknown buttons is exactly
 * what a read-only crawler must not do.
 */
async function harvestLinks(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const push = (root: Document | ShadowRoot) => {
      root.querySelectorAll('a[href]').forEach((a) => {
        const href = a.getAttribute('href');
        if (href) out.push(href);
      });
      root.querySelectorAll('*').forEach((el) => {
        const shadow = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
        if (shadow) push(shadow);
      });
    };
    push(document);
    return out.slice(0, 800);
  });
}

/**
 * ONE URL, ONE IDENTITY.
 *
 * `/users`, `/users/`, `/users#top` and `/users?utm_source=x` are the same page.
 * Without this the crawler spends a 10-page budget on four copies of the
 * dashboard, and the run reports the same bug four times.
 *
 * Query strings that are NOT tracking parameters are kept, because `?tab=billing`
 * genuinely is a different screen.
 */
export function normaliseUrl(input: string): string {
  const u = new URL(input);
  u.hash = '';
  for (const p of TRACKING_PARAMS) u.searchParams.delete(p);
  // Sorted so ?a=1&b=2 and ?b=2&a=1 collapse to one page.
  u.searchParams.sort();
  if (u.pathname !== '/' && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.replace(/\/+$/, '');
  }
  return u.href.replace(/\?$/, '');
}

/** path + search, which is what a person calls "the page". */
export function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}` || '/';
  } catch {
    return url;
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
