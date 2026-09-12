import type { FindingStatus, ResultStatus, RunStatus } from '@/lib/types';

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

/**
 * `plain` drops the lit dot.
 *
 * The dot means "this is a signal reading" — a verdict, a status. A priority or
 * a count is neither: it is a property of the test, not a measurement of it.
 * Putting a lamp on those spends the one visual device that makes a real
 * verdict unmissable, which is the whole reason the theme has it.
 */
function Badge({
  tone,
  plain,
  children,
}: {
  tone: Tone;
  plain?: boolean;
  children: React.ReactNode;
}) {
  return <span className={`badge badge-${tone}${plain ? ' badge-plain' : ''}`}>{children}</span>;
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

/**
 * Priority chip - P0 is a release blocker, so it gets the loud colour.
 * No dot: how urgent a test is is not a reading it produced.
 */
export function PriorityBadge({ priority }: { priority: string }) {
  const tone: Tone =
    priority === 'P0'
      ? 'fail'
      : priority === 'P1'
        ? 'warn'
        : priority === 'P2'
          ? 'info'
          : 'neutral';
  return (
    <Badge tone={tone} plain>
      {priority}
    </Badge>
  );
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

/**
 * WHAT KIND of defect. Sits beside ClassificationBadge, which says whose fault
 * it is - the two answer different questions and a triager needs both.
 *
 * Deliberately quiet styling: the classification badge is the one that drives
 * the decision, and two loud badges side by side read as one confused label.
 */
const CATEGORY_LABEL: Record<string, string> = {
  FUNCTIONAL: 'Functional',
  TECHNICAL: 'Technical',
  DATA: 'Data',
  CONTENT: 'Content',
  UI_VISUAL: 'UI / visual',
  LOADING: 'Loading',
  UNKNOWN: 'Uncategorised',
};

const CATEGORY_ICON: Record<string, string> = {
  FUNCTIONAL: '⚙', // gear - behaviour
  TECHNICAL: '⚡', // bolt - crash / request
  DATA: '▤', // rows - values
  CONTENT: '“', // quote - wording
  UI_VISUAL: '◱', // shaded box - layout
  LOADING: '◌', // dotted circle - spinner
  UNKNOWN: '?',
};

export function CategoryBadge({ value }: { value?: string | null }) {
  if (!value || value === 'UNKNOWN') return null;
  return (
    <span className="badge badge-neutral" title="What kind of defect this is">
      {CATEGORY_ICON[value] ?? ''} {CATEGORY_LABEL[value] ?? value}
    </span>
  );
}
