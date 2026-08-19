import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'node:path';
import type { Env } from './env.validation';

/**
 * Typed, grouped access to configuration.
 *
 * Nothing else in the codebase reads process.env directly. That keeps every
 * tunable value in one documented place (.env.example) and makes the settings
 * discoverable instead of scattered as magic numbers.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  private get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  // --- server ---
  get nodeEnv() {
    return this.get('NODE_ENV');
  }
  get isProduction() {
    return this.get('NODE_ENV') === 'production';
  }
  get port() {
    return this.get('PORT');
  }
  get corsOrigins() {
    return this.get('CORS_ORIGINS');
  }
  /** Absolute base for links that leave the app (bug report exports). */
  get publicApiUrl() {
    return this.get('PUBLIC_API_URL').replace(/\/$/, '');
  }

  // --- llm ---
  get llm() {
    return {
      provider: this.get('LLM_PROVIDER'),
      apiKey: this.get('LLM_API_KEY'),
      baseUrl: this.get('LLM_BASE_URL'),
      model: this.get('LLM_MODEL'),
      maxTokens: this.get('LLM_MAX_TOKENS'),
      temperature: this.get('LLM_TEMPERATURE'),
      timeoutMs: this.get('LLM_TIMEOUT_MS'),
    };
  }

  // --- secrets ---
  get secretsEncryptionKey() {
    return Buffer.from(this.get('SECRETS_ENCRYPTION_KEY'), 'hex');
  }

  // --- browser worker ---
  get auth() {
    return {
      jwtSecret: this.get('JWT_SECRET'),
      accessTtlMinutes: this.get('JWT_ACCESS_TTL_MINUTES'),
      refreshTtlDays: this.get('JWT_REFRESH_TTL_DAYS'),
      allowOpenRegistration: this.get('ALLOW_OPEN_REGISTRATION'),
    };
  }

  get browser() {
    return {
      channel: this.get('BROWSER_CHANNEL'),
      headless: this.get('BROWSER_HEADLESS'),
      slowMo: this.get('BROWSER_SLOW_MO_MS'),
      navigationTimeout: this.get('BROWSER_NAVIGATION_TIMEOUT_MS'),
      actionTimeout: this.get('BROWSER_ACTION_TIMEOUT_MS'),
      assertionTimeout: this.get('BROWSER_ASSERTION_TIMEOUT_MS'),
      viewport: {
        width: this.get('BROWSER_VIEWPORT_WIDTH'),
        height: this.get('BROWSER_VIEWPORT_HEIGHT'),
      },
      scanMaxElements: this.get('SCAN_MAX_ELEMENTS'),
      settleTimeout: this.get('SCAN_SETTLE_TIMEOUT_MS'),
      settlePoll: this.get('SCAN_SETTLE_POLL_MS'),
      settleGrace: this.get('SCAN_SETTLE_GRACE_MS'),
    };
  }

  // --- evidence ---
  /** Absolute path on disk where screenshots and traces are written. */
  get artifactsDir() {
    const configured = this.get('ARTIFACTS_DIR');
    return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
  }
  get captureTraceOnFailure() {
    return this.get('CAPTURE_TRACE_ON_FAILURE');
  }

  // --- execution policy ---
  get policy() {
    return {
      retryFailedOnce: this.get('RETRY_FAILED_ONCE'),
      destructiveKeywords: this.get('DESTRUCTIVE_KEYWORDS').map((k) => k.toLowerCase()),
      maxTestCasesPerRun: this.get('MAX_TEST_CASES_PER_RUN'),
      maxStepsPerCase: this.get('MAX_STEPS_PER_CASE'),
    };
  }
}
