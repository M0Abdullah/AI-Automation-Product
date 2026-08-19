import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Browser, BrowserContext, chromium } from 'playwright';
import { AppConfigService } from '../config/app-config.service';

/**
 * Owns the single Chromium process and hands out clean, isolated contexts.
 *
 * Why one browser, many contexts: launching Chromium costs ~500ms, creating a
 * context costs ~10ms. Each context is its own cookie jar and cache, so tests
 * cannot leak state into each other - which is exactly the isolation the
 * product needs, at a fraction of the cost of a browser per test.
 */
@Injectable()
export class BrowserFactory implements OnModuleDestroy {
  private readonly logger = new Logger(BrowserFactory.name);
  private browser?: Browser;
  private launching?: Promise<Browser>;

  constructor(private readonly config: AppConfigService) {}

  /** Which engine actually launched — recorded on every result as evidence. */
  private activeChannel = 'chromium';

  async getBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    if (this.launching) return this.launching;

    this.launching = this.launch();
    return this.launching;
  }

  /**
   * Launches the configured channel, falling back to bundled Chromium.
   *
   * BROWSER_CHANNEL=chrome drives the real Google Chrome installed on the
   * machine, which is what users actually run - it differs from Chromium on
   * media codecs, the PDF viewer and enterprise policies. But Chrome may not be
   * installed (CI containers, a fresh laptop), so a failure there must degrade
   * to Chromium rather than break the run.
   */
  private async launch(): Promise<Browser> {
    const { channel, headless, slowMo } = this.config.browser;

    const options = {
      headless,
      slowMo,
      // Required in most Docker/CI environments and harmless locally.
      args: ['--disable-dev-shm-usage', '--no-sandbox'],
    };

    const attempts: Array<{ label: string; channel?: string }> =
      channel === 'chromium'
        ? [{ label: 'Chromium (bundled)' }]
        : [
            { label: channel === 'msedge' ? 'Microsoft Edge' : 'Google Chrome', channel },
            { label: 'Chromium (bundled fallback)' },
          ];

    let lastError: unknown;
    for (const attempt of attempts) {
      try {
        const browser = await chromium.launch(
          attempt.channel ? { ...options, channel: attempt.channel } : options,
        );
        this.activeChannel = attempt.channel ?? 'chromium';
        this.browser = browser;
        this.launching = undefined;
        this.logger.log(
          `Launched ${attempt.label} ${browser.version()} (headless=${headless})`,
        );
        browser.on('disconnected', () => {
          this.logger.warn('Browser disconnected - it will be relaunched on next use');
          this.browser = undefined;
        });
        return browser;
      } catch (err) {
        lastError = err;
        this.logger.warn(
          `Could not launch ${attempt.label}: ${(err as Error).message.split('\n')[0]}`,
        );
      }
    }

    this.launching = undefined;
    this.logger.error(
      'No browser could be launched. Install Google Chrome, or run: npx playwright install chromium',
    );
    throw lastError;
  }

  /** A fresh, isolated context. Always close it in a finally block. */
  async newContext(): Promise<BrowserContext> {
    const browser = await this.getBrowser();
    const { viewport, navigationTimeout, actionTimeout } = this.config.browser;

    const context = await browser.newContext({
      viewport,
      ignoreHTTPSErrors: true, // staging environments often use self-signed certs
      locale: 'en-US',
      // Identify the tool honestly in logs of the site under test.
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/131.0.0.0 Safari/537.36 AITestPlatform/0.1',
    });

    context.setDefaultNavigationTimeout(navigationTimeout);
    context.setDefaultTimeout(actionTimeout);
    return context;
  }

  get browserVersion(): string | undefined {
    return this.browser?.version();
  }

  /** 'chrome' | 'msedge' | 'chromium' - what actually ran, not what was asked for. */
  get browserName(): string {
    return this.activeChannel;
  }

  get viewportLabel(): string {
    const { width, height } = this.config.browser.viewport;
    return `${width}x${height}`;
  }

  async onModuleDestroy() {
    if (this.browser) {
      await this.browser.close().catch(() => undefined);
      this.logger.log('Chromium closed');
    }
  }
}
