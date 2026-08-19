import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AppConfigService } from '../config/app-config.service';
import type {
  AssertionResult,
  ErrorType,
  StepResult,
  TestAssertion,
  TestStep,
} from '../common/test-plan.types';
import { executeStep, type ActionContext } from './action-handlers';
import { runAssertion } from './assertion-handlers';
import { BrowserFactory } from './browser.factory';
import {
  AssertionFailedError,
  ExecutableTestCase,
  ExecutionOutcome,
  LocatorNotFoundError,
} from './browser.types';
import { EvidenceCollector } from './evidence-collector';
import { waitForInteractiveContent } from './page-settle';

/**
 * STEP 4 OF THE PIPELINE: run the approved test and judge it.
 *
 * Order of business, deliberately:
 *   1. fresh isolated browser context (no leaked cookies from the last test)
 *   2. start trace recording
 *   3. run every step; a step that throws ends the test
 *   4. run every assertion; assertions decide PASS/FAIL
 *   5. on failure, capture screenshot + trace + logs
 *   6. always tear the context down
 *
 * The outcome object is pure data. Persisting it is someone else's job.
 */
@Injectable()
export class TestExecutorService {
  private readonly logger = new Logger(TestExecutorService.name);

  constructor(
    private readonly browsers: BrowserFactory,
    private readonly config: AppConfigService,
  ) {}

  async execute(args: {
    testCase: ExecutableTestCase;
    startUrl: string;
    values: Record<string, string>;
    runId: string;
    attempt: number;
  }): Promise<ExecutionOutcome> {
    const { testCase, startUrl, values, runId, attempt } = args;
    const startedAt = new Date();
    const t0 = Date.now();

    const { actionTimeout, navigationTimeout, assertionTimeout } = this.config.browser;
    const baseOrigin = new URL(startUrl).origin;

    const stepResults: StepResult[] = [];
    const assertionResults: AssertionResult[] = [];

    let status: ExecutionOutcome['status'] = 'PASS';
    let failedStepIndex: number | undefined;
    let failedStepLabel: string | undefined;
    let errorType: ErrorType | undefined;
    let errorMessage: string | undefined;
    let expected: string | undefined;
    let actual: string | undefined;
    let screenshotPath: string | undefined;
    let tracePath: string | undefined;
    let finalUrl: string | undefined;

    const context = await this.browsers.newContext();
    const traceEnabled = this.config.captureTraceOnFailure;
    if (traceEnabled) {
      await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    }

    const page = await context.newPage();
    const evidence = new EvidenceCollector(page);

    const settleOptions = {
      timeoutMs: this.config.browser.settleTimeout,
      pollMs: this.config.browser.settlePoll,
      graceMs: this.config.browser.settleGrace,
    };

    const actionCtx: ActionContext = {
      values,
      baseOrigin,
      timeouts: { action: actionTimeout, navigation: navigationTimeout },
      settle: settleOptions,
    };

    try {
      // If the plan does not open a page itself, start at the run's URL.
      const firstIsGoto = testCase.steps[0]?.action === 'goto';
      if (!firstIsGoto) {
        await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: navigationTimeout });
        // Same settle wait as the goto action - a test that does not navigate
        // explicitly still must not race against the app rendering.
        await waitForInteractiveContent(page, settleOptions);
      }

      // ----------------------------------------------------------- steps
      for (const [index, step] of testCase.steps.entries()) {
        const s0 = Date.now();
        try {
          const outcome = await executeStep(page, step as TestStep, actionCtx);
          stepResults.push({
            index,
            action: step.action,
            target: step.target,
            status: 'passed',
            locatorStrategy: outcome.locatorStrategy,
            durationMs: Date.now() - s0,
            message: outcome.message,
          });
        } catch (err) {
          const classified = classifyError(err);
          stepResults.push({
            index,
            action: step.action,
            target: step.target,
            status: 'failed',
            durationMs: Date.now() - s0,
            message: classified.message,
          });
          // Mark the remaining steps as skipped so the UI shows where it stopped.
          for (let k = index + 1; k < testCase.steps.length; k++) {
            stepResults.push({
              index: k,
              action: testCase.steps[k].action,
              target: testCase.steps[k].target,
              status: 'skipped',
              durationMs: 0,
            });
          }

          status = classified.errorType === 'ASSERTION_FAILED' ? 'FAIL' : 'ERROR';
          failedStepIndex = index;
          failedStepLabel = `step ${index + 1}: ${step.action} "${step.target}"`;
          errorType = classified.errorType;
          errorMessage = classified.message;
          break;
        }
      }

      // ------------------------------------------------------ assertions
      if (status === 'PASS') {
        for (const [index, assertion] of testCase.assertions.entries()) {
          try {
            const outcome = await runAssertion(page, assertion as TestAssertion, {
              timeoutMs: assertionTimeout,
              evidence,
            });
            assertionResults.push({
              index,
              type: assertion.type,
              target: assertion.target,
              expected: outcome.expected,
              actual: outcome.actual,
              status: 'passed',
              message: outcome.message,
            });
          } catch (err) {
            const classified = classifyError(err);
            assertionResults.push({
              index,
              type: assertion.type,
              target: assertion.target,
              expected: err instanceof AssertionFailedError ? err.expected : undefined,
              actual: err instanceof AssertionFailedError ? err.actual : undefined,
              status: 'failed',
              message: classified.message,
            });
            for (let k = index + 1; k < testCase.assertions.length; k++) {
              assertionResults.push({
                index: k,
                type: testCase.assertions[k].type,
                target: testCase.assertions[k].target,
                status: 'skipped',
              });
            }

            status = 'FAIL';
            errorType = classified.errorType;
            errorMessage = classified.message;
            failedStepLabel = `assertion ${index + 1}: ${assertion.type}`;
            if (err instanceof AssertionFailedError) {
              expected = err.expected;
              actual = err.actual;
            }
            break;
          }
        }
      }

      finalUrl = page.url();

      // -------------------------------------------------------- evidence
      if (status !== 'PASS') {
        screenshotPath = await this.captureScreenshot(page, runId, testCase.id, attempt);
      }
    } catch (err) {
      // Something outside the step/assertion loops broke (navigation, crash).
      const classified = classifyError(err);
      status = 'ERROR';
      errorType = classified.errorType;
      errorMessage = classified.message;
      finalUrl = page.url();
      screenshotPath = await this.captureScreenshot(page, runId, testCase.id, attempt).catch(
        () => undefined,
      );
    } finally {
      if (traceEnabled) {
        if (status !== 'PASS') {
          tracePath = await this.stopTraceToFile(context, runId, testCase.id, attempt);
        } else {
          await context.tracing.stop().catch(() => undefined);
        }
      }
      await page.close().catch(() => undefined);
      await context.close().catch(() => undefined);
    }

    const finishedAt = new Date();
    this.logger.log(
      `[attempt ${attempt}] ${testCase.title} -> ${status} in ${Date.now() - t0}ms` +
        (errorMessage ? ` (${errorType})` : ''),
    );

    return {
      status,
      startedAt,
      finishedAt,
      durationMs: Date.now() - t0,
      stepResults,
      assertionResults,
      failedStepIndex,
      failedStepLabel,
      errorType,
      errorMessage,
      expected,
      actual,
      finalUrl,
      browserName: this.browsers.browserName,
      browserVersion: this.browsers.browserVersion,
      viewport: this.browsers.viewportLabel,
      screenshotPath,
      tracePath,
      console: evidence.console,
      network: evidence.network,
    };
  }

  // ------------------------------------------------------------- artifacts

  /** Returns a path relative to ARTIFACTS_DIR, which is what the API serves. */
  private async captureScreenshot(
    page: import('playwright').Page,
    runId: string,
    caseId: string,
    attempt: number,
  ): Promise<string | undefined> {
    try {
      const rel = path.posix.join(runId, `${caseId}-attempt${attempt}.png`);
      const abs = path.join(this.config.artifactsDir, rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await page.screenshot({ path: abs, fullPage: true });
      return rel;
    } catch (err) {
      this.logger.warn(`Could not capture screenshot: ${String(err)}`);
      return undefined;
    }
  }

  private async stopTraceToFile(
    context: import('playwright').BrowserContext,
    runId: string,
    caseId: string,
    attempt: number,
  ): Promise<string | undefined> {
    try {
      const rel = path.posix.join(runId, `${caseId}-attempt${attempt}-trace.zip`);
      const abs = path.join(this.config.artifactsDir, rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await context.tracing.stop({ path: abs });
      return rel;
    } catch (err) {
      this.logger.warn(`Could not save trace: ${String(err)}`);
      await context.tracing.stop().catch(() => undefined);
      return undefined;
    }
  }
}

/**
 * Maps a thrown error to a stable errorType.
 *
 * This mapping is what keeps false bug reports down: a locator that did not
 * match is a TEST_DEFECT signal, not evidence that the product is broken.
 */
export function classifyError(err: unknown): { errorType: ErrorType; message: string } {
  if (err instanceof LocatorNotFoundError) {
    return { errorType: 'LOCATOR_NOT_FOUND', message: err.message };
  }
  if (err instanceof AssertionFailedError) {
    return { errorType: 'ASSERTION_FAILED', message: err.message };
  }

  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (lower.includes('timeout') || lower.includes('exceeded')) {
    return { errorType: 'TIMEOUT', message };
  }
  if (
    lower.includes('err_name_not_resolved') ||
    lower.includes('err_connection') ||
    lower.includes('net::') ||
    lower.includes('navigation')
  ) {
    return { errorType: 'NAVIGATION', message };
  }
  if (lower.includes('crash') || lower.includes('target closed')) {
    return { errorType: 'PAGE_CRASH', message };
  }
  return { errorType: 'UNKNOWN', message };
}
