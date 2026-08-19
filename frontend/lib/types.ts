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
  aiConfidence?: number | null;
  aiSummary?: string | null;
  aiSuspectedCause?: string | null;
  aiEvidence?: {
    consoleErrors?: string[];
    apiErrors?: string[];
    attempts?: number;
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
  stage: string;
  subject: string;
  reason: string;
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

export interface RunSummary {
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
  testCases: TestCase[];
  rejections: PolicyRejection[];
  findings: Finding[];
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
  _count: { testCases: number; findings: number };
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
  labels: string;
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
