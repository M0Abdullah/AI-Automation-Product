/**
 * STATUS VALUES.
 *
 * On PostgreSQL these were native database enums. SQLite has no enums, so they
 * live here as const objects instead — and the whole codebase imports them from
 * this one file rather than from @prisma/client.
 *
 * That indirection is the reason switching back to PostgreSQL later is cheap:
 * the string values are identical to the Postgres enum labels, so the migration
 * is a schema change plus a data copy, with no application code to rewrite.
 */

export const RunStatus = {
  CREATED: 'CREATED', // row exists, nothing started
  SCANNING: 'SCANNING', // Playwright is reading the page
  SCAN_FAILED: 'SCAN_FAILED', // page unreachable / blocked / empty
  PLANNING: 'PLANNING', // LLM is writing test cases
  PLAN_FAILED: 'PLAN_FAILED', // LLM error, or everything rejected by policy
  AWAITING_APPROVAL: 'AWAITING_APPROVAL', // QA must approve before execution
  RUNNING: 'RUNNING', // Playwright is executing approved cases
  COMPLETED: 'COMPLETED', // execution finished (may contain failures)
} as const;
export type RunStatus = (typeof RunStatus)[keyof typeof RunStatus];

export const ResultStatus = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  FLAKY: 'FLAKY', // failed once, passed on the automatic rerun
  ERROR: 'ERROR', // could not run at all
  SKIPPED: 'SKIPPED',
} as const;
export type ResultStatus = (typeof ResultStatus)[keyof typeof ResultStatus];

export const FindingStatus = {
  NEW: 'NEW', // just created by a failure, awaiting triage
  TRIAGED: 'TRIAGED', // AI classification reviewed, decision pending
  CONFIRMED: 'CONFIRMED', // QA says this is a real product defect
  REJECTED: 'REJECTED', // QA says not a product defect
  REOPENED: 'REOPENED', // was closed, came back
  CLOSED: 'CLOSED', // done
} as const;
export type FindingStatus = (typeof FindingStatus)[keyof typeof FindingStatus];

export const Classification = {
  PRODUCT_BUG: 'PRODUCT_BUG',
  TEST_DEFECT: 'TEST_DEFECT',
  ENVIRONMENT_ISSUE: 'ENVIRONMENT_ISSUE',
  TEST_DATA_ISSUE: 'TEST_DATA_ISSUE',
  FLAKY: 'FLAKY',
  UNKNOWN: 'UNKNOWN',
} as const;
export type Classification = (typeof Classification)[keyof typeof Classification];

export const Severity = {
  S1_BLOCKER: 'S1_BLOCKER',
  S2_MAJOR: 'S2_MAJOR',
  S3_MINOR: 'S3_MINOR',
  S4_TRIVIAL: 'S4_TRIVIAL',
} as const;
export type Severity = (typeof Severity)[keyof typeof Severity];

export const CaseSource = {
  LLM: 'LLM', // proposed by the model
  MANUAL: 'MANUAL', // written or edited by a human
} as const;
export type CaseSource = (typeof CaseSource)[keyof typeof CaseSource];

export const LogLevel = {
  ERROR: 'ERROR',
  WARNING: 'WARNING',
  INFO: 'INFO',
  DEBUG: 'DEBUG',
} as const;
export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

/** Run statuses where the backend is still working — the UI polls on these. */
export const IN_PROGRESS_RUN_STATUSES: RunStatus[] = [
  RunStatus.CREATED,
  RunStatus.SCANNING,
  RunStatus.PLANNING,
  RunStatus.RUNNING,
];

/** Finding statuses that still need a human. Drives the triage inbox badges. */
export const OPEN_FINDING_STATUSES: FindingStatus[] = [
  FindingStatus.NEW,
  FindingStatus.TRIAGED,
  FindingStatus.REOPENED,
];

/** Runtime guard for values arriving from the database or an HTTP request. */
export function isFindingStatus(v: unknown): v is FindingStatus {
  return typeof v === 'string' && v in FindingStatus;
}

/**
 * WHO CAN DO WHAT.
 *
 * OWNER  - everything, including managing users
 * QA     - create runs, approve tests, triage findings, manage tickets
 * DEV    - view everything, comment, move a ticket to Ready for Retest
 * VIEWER - read only
 */
export const UserRole = {
  OWNER: 'OWNER',
  QA: 'QA',
  DEV: 'DEV',
  VIEWER: 'VIEWER',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

/** Roles allowed to change test plans, triage findings and manage tickets. */
export const WRITE_ROLES: UserRole[] = [UserRole.OWNER, UserRole.QA];

/**
 * TICKET LIFECYCLE.
 *
 * READY_FOR_RETEST is the important one: it is the handoff back to QA, and it is
 * where the "rerun the linked test" button lives.
 */
export const TicketStatus = {
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  READY_FOR_RETEST: 'READY_FOR_RETEST',
  RESOLVED: 'RESOLVED',
  REOPENED: 'REOPENED',
  CLOSED: 'CLOSED',
} as const;
export type TicketStatus = (typeof TicketStatus)[keyof typeof TicketStatus];

/** Legal ticket moves. Enforced by TicketsService, not assumed. */
export const TICKET_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ['IN_PROGRESS', 'CLOSED'],
  IN_PROGRESS: ['READY_FOR_RETEST', 'OPEN', 'CLOSED'],
  READY_FOR_RETEST: ['RESOLVED', 'REOPENED', 'IN_PROGRESS'],
  RESOLVED: ['CLOSED', 'REOPENED'],
  REOPENED: ['IN_PROGRESS', 'CLOSED'],
  CLOSED: ['REOPENED'],
};

export const Priority = {
  P0: 'P0',
  P1: 'P1',
  P2: 'P2',
  P3: 'P3',
} as const;
export type Priority = (typeof Priority)[keyof typeof Priority];

/** Counter names used for human-readable keys. */
export const CounterName = {
  BUG: 'bug',
  TICKET: 'ticket',
} as const;
