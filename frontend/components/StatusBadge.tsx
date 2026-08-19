import type { FindingStatus, ResultStatus, RunStatus, TicketStatus } from '../lib/types';
import { TICKET_STATUS_LABEL } from '../lib/types';

type Tone = 'pass' | 'fail' | 'warn' | 'info' | 'neutral' | 'brand';

const RUN_TONE: Record<RunStatus, Tone> = {
  CREATED: 'neutral',
  SCANNING: 'info',
  SCAN_FAILED: 'fail',
  PLANNING: 'info',
  PLAN_FAILED: 'fail',
  AWAITING_APPROVAL: 'warn',
  RUNNING: 'info',
  COMPLETED: 'pass',
};

const RUN_LABEL: Record<RunStatus, string> = {
  CREATED: 'Queued',
  SCANNING: 'Reading the page',
  SCAN_FAILED: 'Scan failed',
  PLANNING: 'AI writing tests',
  PLAN_FAILED: 'Planning failed',
  AWAITING_APPROVAL: 'Awaiting review',
  RUNNING: 'Running',
  COMPLETED: 'Completed',
};

const RESULT_TONE: Record<ResultStatus, Tone> = {
  PASS: 'pass',
  FAIL: 'fail',
  FLAKY: 'warn',
  ERROR: 'fail',
  SKIPPED: 'neutral',
};

const FINDING_TONE: Record<FindingStatus, Tone> = {
  NEW: 'warn',
  TRIAGED: 'info',
  CONFIRMED: 'fail',
  REJECTED: 'neutral',
  REOPENED: 'fail',
  CLOSED: 'pass',
};

function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const busy = ['SCANNING', 'PLANNING', 'RUNNING', 'CREATED'].includes(status);
  return (
    <Badge tone={RUN_TONE[status]}>
      {busy && <span className="spinner" />}
      {RUN_LABEL[status]}
    </Badge>
  );
}

export function ResultStatusBadge({ status }: { status: ResultStatus }) {
  return <Badge tone={RESULT_TONE[status]}>{status}</Badge>;
}

export function FindingStatusBadge({ status }: { status: FindingStatus }) {
  return <Badge tone={FINDING_TONE[status]}>{status}</Badge>;
}

/** Priority chip - P0 is a release blocker, so it gets the loud colour. */
export function PriorityBadge({ priority }: { priority: string }) {
  const tone: Tone =
    priority === 'P0' ? 'fail' : priority === 'P1' ? 'warn' : priority === 'P2' ? 'info' : 'neutral';
  return <Badge tone={tone}>{priority}</Badge>;
}

const CLASSIFICATION_LABEL: Record<string, string> = {
  PRODUCT_BUG: 'Product bug',
  TEST_DEFECT: 'Test defect',
  ENVIRONMENT_ISSUE: 'Environment',
  TEST_DATA_ISSUE: 'Test data',
  FLAKY: 'Flaky',
  UNKNOWN: 'Unknown',
};

export function ClassificationBadge({
  value,
  confidence,
  ai,
}: {
  value?: string | null;
  confidence?: number | null;
  ai?: boolean;
}) {
  if (!value) return null;
  const tone: Tone =
    value === 'PRODUCT_BUG'
      ? 'fail'
      : value === 'TEST_DEFECT'
        ? 'warn'
        : value === 'FLAKY'
          ? 'warn'
          : 'neutral';
  return (
    <Badge tone={tone}>
      {ai ? 'AI: ' : ''}
      {CLASSIFICATION_LABEL[value] ?? value}
      {typeof confidence === 'number' ? ` ${Math.round(confidence * 100)}%` : ''}
    </Badge>
  );
}

/** Ticket lifecycle colours. READY_FOR_RETEST is brand-coloured because it is
 *  the handoff back to QA - the state somebody must act on. */
const TICKET_TONE: Record<TicketStatus, Tone> = {
  OPEN: 'warn',
  IN_PROGRESS: 'info',
  READY_FOR_RETEST: 'brand',
  RESOLVED: 'pass',
  REOPENED: 'fail',
  CLOSED: 'neutral',
};

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return <Badge tone={TICKET_TONE[status]}>{TICKET_STATUS_LABEL[status]}</Badge>;
}
