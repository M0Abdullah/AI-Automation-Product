import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/auth.guard';
import { AppConfigService } from '../config/app-config.service';
import { LlmService } from '../llm/llm.service';
import { PrismaService } from '../prisma/prisma.service';
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
  ) {}

  // Public: the login screen shows a connection indicator before sign-in.
  @Public()
  @Get('health')
  async health() {
    const db = await this.prisma
      .$queryRaw`SELECT 1`
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

  /** What the model is allowed to ask for. Handy for the UI editor dropdowns. */
  @Get('capabilities')
  capabilities() {
    return {
      actions: ALLOWED_ACTIONS,
      assertions: ALLOWED_ASSERTIONS,
      valueRefs: ['test_email', 'test_password'],
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
