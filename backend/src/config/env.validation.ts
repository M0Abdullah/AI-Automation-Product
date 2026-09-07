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
  // Where this API is reachable from OUTSIDE. Used to build absolute links in
  // exported bug reports - a relative /api/artifacts path renders as a broken
  // image once the Markdown is pasted into Jira or Slack.
  PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),

  // --- database ---
  // MongoDB connection string, e.g. mongodb://localhost:27017/aitest or an
  // Atlas mongodb+srv:// URL. Prisma needs the database name in the path.
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

  // ------------------------------------------------------------------ FIGMA
  // Optional: without a token the design comparison is simply unavailable and
  // every other check keeps working. A missing integration must never stop the
  // platform from booting.
  FIGMA_TOKEN: z.string().optional(),
  FIGMA_TIMEOUT_MS: int(20000, 3000),

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
  // The run-wide ceiling. With whole-app mode this is a total across every
  // page, so it is much higher than the old single-page value - but it is still
  // a hard stop, because 200 unreviewed test cases is not a reviewable plan.
  MAX_TEST_CASES_PER_RUN: int(60, 1),
  // The per-page allowance. 8 is what a single-page run used to get, so a
  // one-page run behaves exactly as it did before whole-app mode existed.
  MAX_TEST_CASES_PER_PAGE: int(8, 1),
  MAX_STEPS_PER_CASE: int(25, 1),

  // --- whole-app crawl ---
  // Defaults for a run that does not specify its own. The real cost is one
  // page scan plus one LLM call per page, so the ceilings are deliberately
  // modest - CRAWL_MAX_PAGES_HARD is the limit a user cannot raise from the UI.
  CRAWL_DEFAULT_MAX_PAGES: int(10, 1),
  CRAWL_DEFAULT_MAX_DEPTH: int(2, 1),
  CRAWL_MAX_PAGES_HARD: int(50, 1),
  CRAWL_MAX_DEPTH_HARD: int(5, 1),

  // --- issue tracker (Jira / ClickUp / Linear) -----------------------------
  // Which tracker confirmed bugs are filed into. 'none' keeps everything local.
  TRACKER_PROVIDER: z.enum(['none', 'jira', 'clickup', 'linear']).default('none'),
  // Push automatically when a HUMAN confirms a finding and a ticket is created.
  // Never on a bare test failure - see the comment in tracker.service.ts.
  TRACKER_AUTO_PUSH: bool(false),
  TRACKER_TIMEOUT_MS: int(20000, 1000),

  // Jira Cloud. The token is an API token, NOT the account password.
  JIRA_BASE_URL: z.string().default(''),
  JIRA_EMAIL: z.string().default(''),
  JIRA_API_TOKEN: z.string().default(''),
  JIRA_PROJECT_KEY: z.string().default(''),
  JIRA_ISSUE_TYPE: z.string().default('Bug'),

  // ClickUp. LIST id, not a Space or Folder id.
  CLICKUP_API_TOKEN: z.string().default(''),
  CLICKUP_LIST_ID: z.string().default(''),
  CLICKUP_STATUS: z.string().default(''),

  // Linear. LINEAR_TEAM accepts the team key ("ENG") or its UUID.
  LINEAR_API_KEY: z.string().default(''),
  LINEAR_TEAM: z.string().default(''),

  // --- email notifications -------------------------------------------------
  // Off by default: the platform must run with no mail server at all.
  MAIL_ENABLED: bool(false),
  MAIL_HOST: z.string().default(''),
  MAIL_PORT: int(587, 1),
  // Leave unset to derive from the port (465 = implicit TLS, 587 = STARTTLS).
  MAIL_SECURE: z
    .enum(['true', 'false', ''])
    .default('')
    .transform((v) => (v === '' ? undefined : v === 'true')),
  MAIL_USER: z.string().default(''),
  MAIL_PASSWORD: z.string().default(''),
  // The From header, e.g. "AI QA <qa@yourcompany.com>".
  MAIL_FROM: z.string().default(''),
  MAIL_TIMEOUT_MS: int(15000, 1000),
  // Where the FRONTEND is reachable. Every link in an email is built from it,
  // so localhost produces emails that only work on the developer's machine.
  APP_PUBLIC_URL: z.string().url().default('http://localhost:3000'),

  // Which notifications to send. Separate switches because they have very
  // different audiences: a sign-in alert is security, a run summary is work.
  MAIL_ON_LOGIN: bool(true),
  MAIL_ON_RUN_FINISHED: bool(true),
  MAIL_ON_BUG_FILED: bool(true),
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
