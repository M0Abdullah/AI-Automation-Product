/**
 * Mirror of the backend response shapes.
 *
 * Hand-written on purpose: it documents the contract in one readable place, and
 * a mismatch shows up as a TypeScript error instead of a blank screen.
 */

export type RunStatus =
  | 'CREATED'
  | 'SCANNING'
  | 'SCAN_FAILED'
  | 'PLANNING'
  | 'PLAN_FAILED'
  | 'AWAITING_APPROVAL'
  | 'RUNNING'
  | 'COMPLETED';

export type ResultStatus = 'PASS' | 'FAIL' | 'FLAKY' | 'ERROR' | 'SKIPPED';

export type FindingStatus =
  | 'NEW'
  | 'TRIAGED'
  | 'CONFIRMED'
  | 'REJECTED'
  | 'REOPENED'
  | 'CLOSED';

export type Classification =
  | 'PRODUCT_BUG'
  | 'TEST_DEFECT'
  | 'ENVIRONMENT_ISSUE'
  | 'TEST_DATA_ISSUE'
  | 'FLAKY'
  | 'UNKNOWN';

export interface TestStep {
  action: string;
  target: string;
  valueRef?: string;
  value?: string;
  description?: string;
}

export interface TestAssertion {
  type: string;
  target?: string;
  value?: string;
  description?: string;
}

export interface StepResult {
  index: number;
  action: string;
  target: string;
  status: 'passed' | 'failed' | 'skipped';
  locatorStrategy?: string;
  durationMs: number;
  message?: string;
}

export interface TestResultSummary {
  id: string;
  attempt: number;
  status: ResultStatus;
  durationMs: number;
  errorType?: string | null;
  errorMessage?: string | null;
  expected?: string | null;
  actual?: string | null;
  failedStepLabel?: string | null;
  finalUrl?: string | null;
  screenshotPath?: string | null;
  tracePath?: string | null;
  startedAt: string;
}

export interface TestCase {
  id: string;
  runId: string;
  /** Which page of the app this case tests. Null on cases from single-page runs. */
  pageId?: string | null;
  /** The URL the case starts at. This is what makes a whole-app run work. */
  pageUrl?: string | null;
  title: string;
  priority: string;
  source: 'LLM' | 'MANUAL';
  order: number;
  tags: string[];
  rationale?: string | null;
  requirement?: string | null;
  steps: TestStep[];
  assertions: TestAssertion[];
  approved: boolean;
  rejected: boolean;
  rejectionReason?: string | null;
  destructive: boolean;
  results: TestResultSummary[];
}

export interface ConsoleLog {
  id: string;
  level: 'ERROR' | 'WARNING' | 'INFO' | 'DEBUG';
  message: string;
  location?: string | null;
  at: string;
}

export interface NetworkLog {
  id: string;
  method: string;
  url: string;
  status?: number | null;
  statusText?: string | null;
  resourceType?: string | null;
  failureText?: string | null;
  durationMs?: number | null;
  isApiError: boolean;
  at: string;
}

export interface FindingEvent {
  id: string;
  fromStatus?: FindingStatus | null;
  toStatus: FindingStatus;
  actor: string;
  note?: string | null;
  createdAt: string;
}

/**
 * WHAT KIND of defect. Separate axis from Classification (whose fault):
 * a defect can be PRODUCT_BUG + UI_VISUAL, or PRODUCT_BUG + DATA.
 */
export type BugCategory =
  | 'FUNCTIONAL'
  | 'TECHNICAL'
  | 'DATA'
  | 'CONTENT'
  | 'UI_VISUAL'
  | 'LOADING'
  | 'UNKNOWN';

export type ContentIssueKind =
  | 'TYPO'
  | 'GRAMMAR'
  | 'LABEL'
  | 'CASING'
  | 'PLACEHOLDER'
  | 'INCONSISTENT';

/**
 * An advisory wording problem found by reading the page text.
 * Never a failure and never a bug id - a review suggestion only.
 */
export interface ContentIssue {
  id: string;
  runId: string;
  /** Which page the wording was read from. Essential on a whole-app run. */
  pageId?: string | null;
  pageUrl?: string | null;
  kind: ContentIssueKind;
  text: string;
  suggestion?: string | null;
  reason?: string | null;
  confidence: number;
  whereSeen?: string | null;
  status: 'NEW' | 'ACCEPTED' | 'DISMISSED';
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
}

/** Families of design property, so the UI can group and bulk-dismiss. */
export type DesignIssueGroup = 'SIZE' | 'TYPOGRAPHY' | 'COLOUR' | 'SPACING' | 'ICON';

/** One place the live page disagrees with the Figma design. Advisory. */
export interface DesignIssue {
  id: string;
  runId: string;
  /** The single page the design was compared against. */
  pageId?: string | null;
  pageUrl?: string | null;
  /**
   * 'button height' | 'control height' | 'corner radius' | 'icon size' |
   * 'padding' | 'gap' | 'font size' | 'font family' | 'font weight' |
   * 'text colour' | 'background colour' | 'border colour'
   */
  property: string;
  /** Which family `property` belongs to. Absent on pre-grouping runs. */
  group?: DesignIssueGroup;
  element: string;
  selector: string;
  actual: string;
  expected: string;
  /** Distance from the design value. Smaller = more likely a real mistake. */
  offBy: number;
  note?: string | null;
  status: 'NEW' | 'ACCEPTED' | 'DISMISSED';
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
}

export interface Finding {
  id: string;
  /** Permanent bug id (BUG-007). Null until a human confirms the defect. */
  bugKey?: string | null;
  bugNumber?: number | null;
  module?: string | null;
  build?: string | null;
  priority?: string | null;
  ticket?: {
    id: string;
    key: string;
    status: TicketStatus;
    externalKey?: string | null;
    externalUrl?: string | null;
  } | null;
  runId: string;
  testCaseId: string;
  resultId: string;
  status: FindingStatus;
  severity?: string | null;
  assignee?: string | null;
  signature: string;
  aiClassification?: Classification | null;
  /** WHAT KIND of defect, independent of whose fault it is. */
  aiCategory?: BugCategory | null;
  aiConfidence?: number | null;
  aiSummary?: string | null;
  aiSuspectedCause?: string | null;
  aiEvidence?: {
    consoleErrors?: string[];
    apiErrors?: string[];
    attempts?: number;
    /** Which page broke - the first thing a triager needs on a whole-app run. */
    pageUrl?: string;
    evidenceUsed?: string[];
    recommendedNextStep?: string;
  } | null;
  humanClassification?: Classification | null;
  triagedBy?: string | null;
  triagedAt?: string | null;
  note?: string | null;
  occurrences: number;
  lastSeenAt: string;
  createdAt: string;
  testCase: { id: string; title: string; priority: string; requirement?: string | null };
  events: FindingEvent[];
  /** Present on list responses, so the screenshot can render without a second fetch. */
  result?: {
    id: string;
    status: string;
    errorType?: string | null;
    errorMessage?: string | null;
    expected?: string | null;
    actual?: string | null;
    screenshotPath?: string | null;
    tracePath?: string | null;
    finalUrl?: string | null;
    browserName?: string | null;
    viewport?: string | null;
  } | null;
}

export interface PolicyRejection {
  id: string;
  /**
   * ACTION_NOT_ALLOWED | DESTRUCTIVE | NO_ASSERTIONS | LIMIT_EXCEEDED |
   * NOT_TESTABLE | QUESTION_FOR_QA | CRAWL_SKIPPED | ...
   *
   * CRAWL_SKIPPED is not a rejection of a test step - it is a link the crawler
   * deliberately did not follow. It shares this table because the question it
   * answers is the same one: "what did you leave out, and why".
   */
  stage: string;
  subject: string;
  reason: string;
  /** Which page's plan this came from. Null for run-level entries. */
  pageUrl?: string | null;
  createdAt: string;
}

export interface ScannedElement {
  kind: string;
  label: string;
  type?: string;
  placeholder?: string;
  href?: string;
  required?: boolean;
  options?: string[];
  labelSource?: string;
}

export interface PageSnapshot {
  url: string;
  finalUrl: string;
  title: string;
  httpStatus: number | null;
  headings: string[];
  elements: ScannedElement[];
  forms: Array<{ method: string; action: string; fields: string[] }>;
  visibleTextSample: string;
  consoleErrors: string[];
  failedRequests: string[];
  scannedAt: string;
  durationMs: number;
  truncated: boolean;
}

export type RunPageStatus =
  | 'DISCOVERED'
  | 'SCANNING'
  | 'SCANNED'
  | 'PLANNED'
  | 'SCAN_FAILED'
  | 'PLAN_FAILED'
  | 'SKIPPED';

/**
 * ONE PAGE OF THE APP UNDER TEST.
 *
 * A single-page run has exactly one of these, so the UI has no special case:
 * it renders the page list whenever there is more than one.
 *
 * `pageSnapshot` is deliberately absent here - twelve snapshots would be
 * megabytes on a payload polled every couple of seconds. Fetch one page with
 * api.getRunPage(runId, pageId) when its panel is opened.
 */
export interface RunPage {
  id: string;
  url: string;
  /** path + query, e.g. "/settings/billing". */
  path: string;
  title?: string | null;
  /** The URL the user submitted. Exactly one page per run has this. */
  isEntry: boolean;
  /** Which page linked to this one - answers "why is this in my run". */
  discoveredFrom?: string | null;
  depth: number;
  order: number;
  status: RunPageStatus;
  statusMessage?: string | null;
  elementCount: number;
  scannedAt?: string | null;
  plannedAt?: string | null;
  _count?: { testCases: number; contentIssues: number; designIssues: number };
}

/** One page with everything about it. From GET /api/runs/:id/pages/:pageId. */
export interface RunPageDetail extends RunPage {
  pageSnapshot?: PageSnapshot | null;
  contentIssues: ContentIssue[];
  designIssues: DesignIssue[];
  testCases: Array<{ id: string; title: string; priority: string }>;
}

export interface RunSummary {
  /** Page totals. 1 on a single-page run. */
  totalPages: number;
  pagesPlanned: number;
  /**
   * Pages that could not be read or planned. The most important number on a
   * whole-app run: a green suite over a third of the app is a lie.
   */
  pagesFailed: number;
  pagesSkipped: number;
  totalCases: number;
  approvedCases: number;
  rejectedCases: number;
  executed: number;
  passed: number;
  failed: number;
  errored: number;
  flaky: number;
  openFindings: number;
  confirmedFindings: number;
}

export interface RunDetail {
  id: string;
  name: string;
  targetUrl: string;
  requirements: string;
  status: RunStatus;
  statusMessage?: string | null;
  authorized: boolean;
  allowDestructive: boolean;
  pageSnapshot?: PageSnapshot | null;
  llmModel?: string | null;
  llmTokensIn?: number | null;
  llmTokensOut?: number | null;
  llmLatencyMs?: number | null;
  createdAt: string;
  finishedAt?: string | null;
  hasCredentials: boolean;
  project: { id: string; name: string; baseUrl: string };
  /** Set when this run signs in before testing. */
  loginUrl?: string | null;
  /** How the sign-in was confirmed, e.g. "navigated from /login to /secure". */
  sessionEvidence?: string | null;
  /** Every page in the run, in crawl order. One entry for a single-page run. */
  pages: RunPage[];
  testCases: TestCase[];
  rejections: PolicyRejection[];
  findings: Finding[];
  /** Advisory wording problems. Absent on runs made before the content pass shipped. */
  contentIssues?: ContentIssue[];
  /** Advisory design deviations. Only present when a Figma frame was given. */
  designIssues?: DesignIssue[];
  figmaFileKey?: string | null;
  figmaNodeId?: string | null;
  /**
   * The ONE page the Figma frame is compared against. Null = the entry URL.
   * The design check stays single-page even when the run covers the whole app.
   */
  designPageUrl?: string | null;
  /** What was read from Figma and how the comparison went, in one line. */
  designSpecSummary?: string | null;

  // --------------------------------------------------------- whole-app scope
  /** True when this run crawled the app rather than testing one URL. */
  crawlEnabled: boolean;
  maxPages: number;
  maxDepth: number;
  includePaths: string[];
  excludePaths: string[];
  crawlStartedAt?: string | null;

  summary: RunSummary;
}

export interface RunListItem {
  id: string;
  name: string;
  targetUrl: string;
  status: RunStatus;
  statusMessage?: string | null;
  createdAt: string;
  finishedAt?: string | null;
  project: { id: string; name: string };
  crawlEnabled?: boolean;
  _count: { testCases: number; findings: number; pages: number };
}

export interface ResultDetail extends TestResultSummary {
  stepResults: StepResult[];
  browserName: string;
  browserVersion?: string | null;
  viewport?: string | null;
  consoleLogs: ConsoleLog[];
  networkLogs: NetworkLog[];
  consoleErrors: ConsoleLog[];
  consoleWarnings: ConsoleLog[];
  apiErrors: NetworkLog[];
  testCase: { id: string; title: string; priority: string; requirement?: string | null };
  finding?: { id: string; status: FindingStatus } | null;
}

/** Statuses where the backend is still working and the UI should poll. */
export const IN_PROGRESS_STATUSES: RunStatus[] = ['CREATED', 'SCANNING', 'PLANNING', 'RUNNING'];

// ============================================================ auth & people

export interface TeamMember {
  id: string;
  email: string;
  name: string;
  role: 'OWNER' | 'QA' | 'DEV' | 'VIEWER';
  lastLoginAt?: string | null;
}

export interface LoginSession {
  id: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string | null;
}

// =================================================================== tickets

export type TicketStatus =
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'READY_FOR_RETEST'
  | 'RESOLVED'
  | 'REOPENED'
  | 'CLOSED';

export interface TicketComment {
  id: string;
  body: string;
  createdAt: string;
  author?: { id: string; name: string; email: string } | null;
}

export interface TicketEvent {
  id: string;
  field: string;
  fromValue?: string | null;
  toValue?: string | null;
  actor: string;
  note?: string | null;
  createdAt: string;
}

export interface Ticket {
  id: string;
  key: string;
  number: number;
  findingId: string;
  title: string;
  description: string;
  status: TicketStatus;
  priority: string;
  severity?: string | null;
  module?: string | null;
  build?: string | null;
  /** A real array now, not a comma-separated string. */
  labels: string[];
  dueDate?: string | null;
  assignee?: { id: string; name: string; email: string } | null;
  reporter?: { id: string; name: string; email: string } | null;
  externalKey?: string | null;
  externalUrl?: string | null;
  externalProvider?: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string | null;
  closedAt?: string | null;
  finding?: {
    id: string;
    bugKey?: string | null;
    status: string;
    severity?: string | null;
    aiClassification?: string | null;
    humanClassification?: string | null;
    occurrences: number;
    runId: string;
    testCaseId: string;
    result?: {
      id: string;
      screenshotPath?: string | null;
      tracePath?: string | null;
      browserName?: string | null;
      viewport?: string | null;
      attempt?: number;
    } | null;
  };
  comments?: TicketComment[];
  events?: TicketEvent[];
}

/**
 * WHICH ISSUE TRACKER THIS INSTANCE FILES INTO.
 *
 * `enabled` folds together "a provider is selected" and "it is fully
 * configured", so no component has to re-derive whether a push can work.
 */
export type TrackerName = 'jira' | 'clickup' | 'linear';

/** Where a confirmed bug can be filed. 'local' keeps it in this tool only. */
export type TicketDestination = TrackerName | 'local';

export interface TrackerStatus {
  enabled: boolean;
  /** The DEFAULT selection, not the only option. See `providers`. */
  provider: 'none' | TrackerName;
  /** Human label, e.g. "Jira (acme.atlassian.net, project QA)". */
  describe: string;
  /** True when a confirmed defect is filed automatically, with no extra click. */
  autoPush: boolean;
  /** Env vars still missing. Empty when `enabled`. */
  missingConfig: string[];
  /**
   * EVERY tracker that is fully configured — the options to offer the user.
   * More than one can be set up at once, so the destination is a per-bug
   * choice rather than a deployment setting.
   */
  providers: Array<{ name: TrackerName; describe: string }>;
  /** The ones that are not set up, and what each is missing. */
  unconfigured: Array<{ name: TrackerName; missingConfig: string[] }>;
}

/**
 * EVERYTHING THIS INSTANCE IS CONNECTED TO.
 *
 * Carries no secrets — a host and a project key, never a token. The endpoint
 * behind it is readable by every role, VIEWER included.
 */
export interface IntegrationStatus {
  tracker: TrackerStatus;
  mail: {
    enabled: boolean;
    host: string | null;
    port: number;
    from: string | null;
    /** Which notifications would actually be sent. */
    events: { onLogin: boolean; onRunFinished: boolean; onBugFiled: boolean };
    /** The base every link in an email is built from. */
    appUrl: string;
  };
}

/** Human labels for the ticket lifecycle. */
export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  READY_FOR_RETEST: 'Ready for retest',
  RESOLVED: 'Resolved',
  REOPENED: 'Reopened',
  CLOSED: 'Closed',
};

/** Mirrors TICKET_TRANSITIONS on the backend, so the UI only offers legal moves. */
export const TICKET_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ['IN_PROGRESS', 'CLOSED'],
  IN_PROGRESS: ['READY_FOR_RETEST', 'OPEN', 'CLOSED'],
  READY_FOR_RETEST: ['RESOLVED', 'REOPENED', 'IN_PROGRESS'],
  RESOLVED: ['CLOSED', 'REOPENED'],
  REOPENED: ['IN_PROGRESS', 'CLOSED'],
  CLOSED: ['REOPENED'],
};

export const SEVERITY_LABEL: Record<string, string> = {
  S1_BLOCKER: 'S1 Blocker',
  S2_MAJOR: 'S2 Major',
  S3_MINOR: 'S3 Minor',
  S4_TRIVIAL: 'S4 Trivial',
};

// ================================================================= dashboard

export interface DashboardOverview {
  runs: { total: number; byStatus: Record<string, number> };
  tests: {
    total: number;
    approved: number;
    humanEdited: number;
    executed: number;
    passed: number;
    failed: number;
    errored: number;
    flaky: number;
    /** null when nothing has been executed yet - not 0, which would read as "all failing". */
    passRate: number | null;
  };
  findings: {
    byStatus: Record<string, number>;
    awaitingTriage: number;
    confirmed: number;
    bySeverity: Record<string, number>;
    byClassification: Record<string, number>;
  };
  tickets: {
    byStatus: Record<string, number>;
    open: number;
    readyForRetest: number;
  };
  llm: { tokensIn: number; tokensOut: number };
  recentRuns: Array<{
    id: string;
    name: string;
    targetUrl: string;
    status: RunStatus;
    statusMessage?: string | null;
    createdAt: string;
    _count: { testCases: number; findings: number };
  }>;
  needsTriage: Array<{
    id: string;
    bugKey?: string | null;
    status: FindingStatus;
    aiClassification?: Classification | null;
    aiConfidence?: number | null;
    occurrences: number;
    runId: string;
    testCase: { title: string; priority: string };
  }>;
  needsRetest: Array<{
    id: string;
    key: string;
    title: string;
    status: TicketStatus;
    priority: string;
    assignee?: { name: string } | null;
  }>;
}

/** One tickable check, served by /api/capabilities. */
export interface CheckOption {
  id: string;
  label: string;
  description: string;
  group: string;
  defaultOn: boolean;
  requiresCredentials: boolean;
}
