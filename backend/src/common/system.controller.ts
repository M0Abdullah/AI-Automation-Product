import { Controller, Get, Post } from '@nestjs/common';
import { Public, RequireWrite } from '../auth/auth.guard';
import { AppConfigService } from '../config/app-config.service';
import { LlmService } from '../llm/llm.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { TrackerService } from '../trackers/tracker.service';
import { CHECK_CATALOG } from './check-catalog';
import { ALLOWED_ACTIONS, ALLOWED_ASSERTIONS } from './test-plan.types';

/**
 * Diagnostics. Hit /api/health first whenever something does not work - it
 * tells you which of the three pieces (database, LLM, browser config) is wrong,
 * instead of leaving you guessing.
 */
@Controller()
export class SystemController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly llm: LlmService,
    private readonly trackers: TrackerService,
    private readonly mail: MailService,
  ) {}

  // Public: the login screen shows a connection indicator before sign-in.
  @Public()
  @Get('health')
  async health() {
    // `ping` rather than a query: it is the cheapest command MongoDB answers,
    // it needs no collection to exist, and unlike a find() it cannot report
    // healthy from a cached connection that the server has since dropped.
    const db = await this.prisma
      .$runCommandRaw({ ping: 1 })
      .then(() => ({ ok: true }))
      .catch((e) => ({ ok: false, error: String(e).slice(0, 200) }));

    return {
      ok: db.ok,
      env: this.config.nodeEnv,
      database: db,
      llm: {
        provider: this.config.llm.provider,
        model: this.config.llm.model,
        baseUrl: this.config.llm.baseUrl,
        // Never expose the key. Only prove that one is loaded.
        keyLoaded: this.config.llm.apiKey.length > 10,
      },
      browser: {
        headless: this.config.browser.headless,
        viewport: this.config.browser.viewport,
      },
      artifactsDir: this.config.artifactsDir,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * WHAT THIS INSTANCE IS CONNECTED TO.
   *
   * Deliberately reports only booleans and non-secret identifiers — a host, a
   * project key, a From address. No token, no password, not even a masked one:
   * a masked secret still leaks its length, and this endpoint is readable by
   * every signed-in role including VIEWER.
   */
  @Get('integrations')
  integrations() {
    const mail = this.config.mail;
    const tracker = this.trackers.status();

    return {
      tracker,
      mail: {
        enabled: mail.enabled,
        host: mail.host || null,
        port: mail.port,
        from: mail.from || null,
        // Which notifications would actually be sent, so "why did I not get an
        // email" is answerable without reading the server's env.
        events: {
          onLogin: mail.onLogin,
          onRunFinished: mail.onRunFinished,
          onBugFiled: mail.onBugFiled,
        },
        appUrl: mail.appUrl,
      },
    };
  }

  /**
   * POST /api/integrations/mail/verify — check the SMTP credentials.
   *
   * Verifies the connection rather than sending a message, so pressing it
   * cannot put a test email in somebody's inbox.
   */
  @RequireWrite()
  @Post('integrations/mail/verify')
  verifyMail() {
    return this.mail.verify();
  }

  /** What the model is allowed to ask for. Handy for the UI editor dropdowns. */
  @Get('capabilities')
  capabilities() {
    return {
      actions: ALLOWED_ACTIONS,
      assertions: ALLOWED_ASSERTIONS,
      valueRefs: ['test_email', 'test_password'],
      // The tickable checklist. Served from here so the UI and the prompt can
      // never disagree about what a check means.
      checks: CHECK_CATALOG.map((c) => ({
        id: c.id,
        label: c.label,
        description: c.description,
        group: c.group,
        defaultOn: c.defaultOn,
        requiresCredentials: Boolean(c.requiresCredentials),
      })),
      policy: {
        maxTestCasesPerRun: this.config.policy.maxTestCasesPerRun,
        maxStepsPerCase: this.config.policy.maxStepsPerCase,
        destructiveKeywords: this.config.policy.destructiveKeywords,
        retryFailedOnce: this.config.policy.retryFailedOnce,
      },
    };
  }

  /** Lists model ids the configured key can use. Useful when LLM_MODEL is wrong. */
  @Get('llm/models')
  async models() {
    try {
      return { models: await this.llm.listModels(), current: this.config.llm.model };
    } catch (err) {
      return { error: String(err), current: this.config.llm.model };
    }
  }
}
