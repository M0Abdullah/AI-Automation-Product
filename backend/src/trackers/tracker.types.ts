/**
 * THE ISSUE-TRACKER CONTRACT.
 *
 * One interface, three implementations (Jira, ClickUp, Linear). Everything
 * provider-specific — auth headers, payload shape, priority numbering,
 * attachment endpoints — lives behind it, so `TicketsService` never learns that
 * ClickUp calls priority `2` what Jira calls `"High"`.
 *
 * Adding a fourth tracker means adding one file and one entry in
 * `tracker.service.ts`. Nothing else changes.
 */

/** What the platform knows about a defect, in tracker-neutral terms. */
export interface TrackerIssueInput {
  /** One line. Already carries the BUG key, e.g. "BUG-007: Login rejects …". */
  title: string;
  /** The generated bug report, as Markdown. Providers convert as needed. */
  markdown: string;
  /** P0 | P1 | P2 | P3 — mapped to each tracker's own scale. */
  priority?: string | null;
  /** S1_BLOCKER … S4_TRIVIAL. Sent as a label where there is no native field. */
  severity?: string | null;
  labels: string[];
  /**
   * Absolute paths of evidence files to attach — the failure screenshot, and
   * the Playwright trace when there is one.
   *
   * Attachments are what make a filed ticket actionable without opening this
   * tool at all, which is the whole point of pushing it out.
   */
  attachments: Array<{ path: string; filename: string; contentType: string }>;
  /**
   * Stable per-ticket string sent to the tracker where it supports idempotency.
   * Stops a double-click, or a retry after a timeout, creating two issues.
   */
  idempotencyKey: string;
}

/** What came back. `key` is what people say out loud; `url` is what they click. */
export interface TrackerIssue {
  /** JIRA: "QA-142" · Linear: "ENG-88" · ClickUp: the task id */
  key: string;
  url: string;
  provider: TrackerProviderName;
  /** Attachments the provider actually managed to upload. */
  attachmentsUploaded: number;
  /**
   * Non-fatal problems — an issue was created but its screenshot did not
   * upload, say. Surfaced rather than swallowed: a ticket without its evidence
   * looks complete and is not.
   */
  warnings: string[];
}

export type TrackerProviderName = 'jira' | 'clickup' | 'linear';

/**
 * A tracker call that failed in a way the user can act on.
 *
 * `hint` is mandatory. "401 Unauthorized" tells somebody nothing; "the API
 * token is wrong or expired — regenerate it at id.atlassian.com" tells them
 * exactly what to do, and this is precisely the class of error where a bad
 * message costs an afternoon.
 */
export class TrackerError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly hint: string,
    readonly provider: TrackerProviderName,
  ) {
    super(message);
    this.name = 'TrackerError';
  }
}

export interface TrackerProvider {
  readonly name: TrackerProviderName;
  /** Human label for the UI, e.g. "Jira (project QA)". */
  describe(): string;
  /** Everything needed is configured. Checked before any call is attempted. */
  isConfigured(): boolean;
  /** Which env vars are missing, for the error message when it is not. */
  missingConfig(): string[];
  /** Create the issue. Throws TrackerError on failure. */
  create(input: TrackerIssueInput): Promise<TrackerIssue>;
  /**
   * Verify credentials without creating anything.
   *
   * Exists so the "Test connection" button cannot work by filing a junk issue
   * into somebody's real backlog.
   */
  verify(): Promise<{ ok: boolean; detail: string }>;
}

/** P0..P3 -> a 1..4 urgency, which is the scale Linear and ClickUp both use. */
export function priorityToUrgency(priority?: string | null): 1 | 2 | 3 | 4 {
  switch ((priority ?? 'P2').toUpperCase()) {
    case 'P0':
      return 1; // urgent
    case 'P1':
      return 2; // high
    case 'P3':
      return 4; // low
    default:
      return 3; // normal
  }
}

/**
 * Labels every filed issue carries, on top of the user's own.
 *
 * `ai-qa-platform` is the load-bearing one: it makes "show me everything this
 * tool filed" a single JQL query, which is what a team needs the first time
 * they want to audit or bulk-close what an automated reporter created.
 */
export function standardLabels(input: TrackerIssueInput): string[] {
  const out = new Set(['ai-qa-platform', ...input.labels]);
  if (input.severity) out.add(input.severity.toLowerCase().replace(/_/g, '-'));
  return [...out]
    // Jira rejects labels containing whitespace, and silently mangles some
    // punctuation. Normalising here keeps one rule for every provider.
    .map((l) => l.trim().replace(/\s+/g, '-'))
    .filter((l) => l.length > 0 && l.length <= 50)
    .slice(0, 20);
}
