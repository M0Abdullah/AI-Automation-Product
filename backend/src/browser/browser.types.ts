import type {
  AssertionResult,
  ErrorType,
  StepResult,
  TestAssertion,
  TestStep,
} from '../common/test-plan.types';

/** One interactive thing the scanner found on the page. */
export interface ScannedElement {
  kind: 'input' | 'textarea' | 'button' | 'link' | 'select' | 'checkbox' | 'radio';
  /** The text a human (and the LLM) would use to refer to it. */
  label: string;
  type?: string;
  placeholder?: string;
  href?: string;
  required?: boolean;
  options?: string[];
  /** How the label was derived - useful when a locator later fails. */
  labelSource?: 'aria-label' | 'label-for' | 'wrapping-label' | 'placeholder' | 'name' | 'text';
}

export interface ScannedForm {
  method: string;
  action: string;
  fields: string[];
}

/**
 * Everything Playwright saw on the page. This is what gets handed to the LLM,
 * and it is stored on the run so QA can see exactly what the AI was told.
 */
export interface PageSnapshot {
  url: string;
  finalUrl: string;
  title: string;
  httpStatus: number | null;
  headings: string[];
  elements: ScannedElement[];
  forms: ScannedForm[];
  visibleTextSample: string;
  consoleErrors: string[];
  failedRequests: string[];
  scannedAt: string;
  durationMs: number;
  truncated: boolean;
  /** Did interactive content appear before SCAN_SETTLE_TIMEOUT_MS elapsed? */
  settled: boolean;
  /** How long we waited for the app to paint something interactive. */
  settleMs: number;
}

/** Raw evidence captured by the listeners during one test execution. */
export interface CapturedConsole {
  level: 'ERROR' | 'WARNING' | 'INFO' | 'DEBUG';
  message: string;
  location?: string;
  at: Date;
}

export interface CapturedRequest {
  method: string;
  url: string;
  status?: number;
  statusText?: string;
  resourceType?: string;
  failureText?: string;
  durationMs?: number;
  isApiError: boolean;
  at: Date;
}

/** Everything one execution attempt produced. */
export interface ExecutionOutcome {
  status: 'PASS' | 'FAIL' | 'ERROR';
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;

  stepResults: StepResult[];
  assertionResults: AssertionResult[];

  failedStepIndex?: number;
  failedStepLabel?: string;
  errorType?: ErrorType;
  errorMessage?: string;
  expected?: string;
  actual?: string;

  finalUrl?: string;
  browserName: string;
  browserVersion?: string;
  viewport: string;

  screenshotPath?: string;
  tracePath?: string;

  console: CapturedConsole[];
  network: CapturedRequest[];
}

export interface ExecutableTestCase {
  id: string;
  title: string;
  steps: TestStep[];
  assertions: TestAssertion[];
}

/** Thrown when no locator strategy could find the target element. */
export class LocatorNotFoundError extends Error {
  readonly errorType: ErrorType = 'LOCATOR_NOT_FOUND';
  constructor(
    readonly target: string,
    readonly attemptedStrategies: string[],
  ) {
    super(
      `Could not find "${target}" on the page. Tried: ${attemptedStrategies.join(', ')}. ` +
        'This usually means the generated locator does not match the real page (a test defect), ' +
        'not that the application is broken.',
    );
    this.name = 'LocatorNotFoundError';
  }
}

/** Thrown when a deterministic assertion fails. This is what a FAIL means. */
export class AssertionFailedError extends Error {
  readonly errorType: ErrorType = 'ASSERTION_FAILED';
  constructor(
    message: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(message);
    this.name = 'AssertionFailedError';
  }
}
