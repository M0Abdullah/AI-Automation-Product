import { z } from 'zod';

/**
 * Every environment variable the backend understands, validated ONCE at boot.
 *
 * Why validate: a typo in .env used to surface as a confusing runtime crash
 * three minutes into a test run. Now the process refuses to start and tells
 * you exactly which variable is wrong.
 */

const csv = (fallback: string[] = []) =>
  z
    .string()
    .optional()
    .transform((v) =>
      (v ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .transform((arr) => (arr.length ? arr : fallback));

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v.toLowerCase() === 'true'));

const int = (def: number, min = 0) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().int().min(min));

export const envSchema = z.object({
  // --- server ---
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: int(4000, 1),
  CORS_ORIGINS: csv(['http://localhost:3000']),

  // --- database ---
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // --- llm ---
  // groq and openai both speak the OpenAI-compatible protocol, so one
  // provider implementation covers both. Only the base URL differs.
  LLM_PROVIDER: z.enum(['groq', 'openai']).default('groq'),
  LLM_API_KEY: z.string().min(10, 'LLM_API_KEY is required (get one at console.groq.com)'),
  LLM_BASE_URL: z.string().url().default('https://api.groq.com/openai/v1'),
  LLM_MODEL: z.string().default('openai/gpt-oss-120b'),
  LLM_MAX_TOKENS: int(8000, 256),
  LLM_TEMPERATURE: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? 0.1 : Number(v)))
    .pipe(z.number().min(0).max(2)),
  LLM_TIMEOUT_MS: int(90000, 5000),

  // --- auth ---
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  /// Access tokens are short-lived; the refresh token in the DB does the rest.
  JWT_ACCESS_TTL_MINUTES: int(60, 5),
  JWT_REFRESH_TTL_DAYS: int(30, 1),
  /// The first account to register becomes OWNER. Set false once set up.
  ALLOW_OPEN_REGISTRATION: bool(true),

  // --- secrets ---
  SECRETS_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'SECRETS_ENCRYPTION_KEY must be 64 hex chars (32 bytes)'),

  // --- browser worker ---
  // 'chrome' drives your real installed Google Chrome; 'chromium' uses the
  // build Playwright downloaded. Chrome is closer to what users actually run
  // (codecs, PDF viewer, enterprise policies); chromium always exists.
  BROWSER_CHANNEL: z.enum(['chrome', 'msedge', 'chromium']).default('chrome'),
  BROWSER_HEADLESS: bool(true),
  BROWSER_SLOW_MO_MS: int(0),
  BROWSER_NAVIGATION_TIMEOUT_MS: int(30000, 1000),
  BROWSER_ACTION_TIMEOUT_MS: int(10000, 500),
  BROWSER_ASSERTION_TIMEOUT_MS: int(7000, 500),
  BROWSER_VIEWPORT_WIDTH: int(1366, 320),
  BROWSER_VIEWPORT_HEIGHT: int(768, 320),
  SCAN_MAX_ELEMENTS: int(80, 5),
  // How long the scanner waits for a client-rendered app to actually paint
  // something interactive. Raise it for apps with a slow auth check or a large
  // bundle; a "Loading..." spinner is the classic symptom of this being too low.
  SCAN_SETTLE_TIMEOUT_MS: int(15000, 1000),
  SCAN_SETTLE_POLL_MS: int(250, 50),
  // Extra pause after the first interactive element appears, so a form that
  // renders field-by-field is captured whole rather than half-built.
  SCAN_SETTLE_GRACE_MS: int(700, 0),

  // --- evidence ---
  ARTIFACTS_DIR: z.string().default('../artifacts'),
  CAPTURE_TRACE_ON_FAILURE: bool(true),

  // --- execution policy ---
  RETRY_FAILED_ONCE: bool(true),
  DESTRUCTIVE_KEYWORDS: csv([
    'delete',
    'remove',
    'pay',
    'purchase',
    'checkout',
    'buy',
    'send',
    'invite',
    'transfer',
    'deactivate',
    'unsubscribe',
  ]),
  MAX_TEST_CASES_PER_RUN: int(12, 1),
  MAX_STEPS_PER_CASE: int(25, 1),
});

export type Env = z.infer<typeof envSchema>;

/** Passed to ConfigModule.forRoot({ validate }). Throws with a readable list. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(
      [
        '',
        'Invalid backend environment configuration:',
        ...lines,
        '',
        'Fix backend/.env (copy backend/.env.example if you have not yet).',
        '',
      ].join('\n'),
    );
  }
  return parsed.data;
}
