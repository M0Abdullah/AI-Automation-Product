import { Injectable, Logger } from '@nestjs/common';
import type { Run, TestCase } from '@prisma/client';
import * as crypto from 'node:crypto';
import { PageScannerService } from '../browser/page-scanner.service';
import { TestExecutorService } from '../browser/test-executor.service';
import type { ExecutionOutcome } from '../browser/browser.types';
import { resolveChecks } from '../common/check-catalog';
import { packJson, packJsonNullable, packTags, unpackJson, unpackTags } from '../common/db-json';
import { Classification, ResultStatus, RunStatus } from '../common/enums';
import { AppConfigService } from '../config/app-config.service';
import { LlmService } from '../llm/llm.service';
import { PolicyService } from '../policy/policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { SecretsService } from '../secrets/secrets.service';
import type { StepResult, TestAssertion, TestStep } from '../common/test-plan.types';

/**
 * THE PIPELINE. This file is the product.
 *
 *   PLAN PHASE (startPlanning)
 *     1. Playwright scans the page                   -> PageSnapshot
 *     2. LLM turns requirements + snapshot into JSON  -> proposed cases
 *     3. Policy engine validates every step           -> accepted / rejected
 *     4. Accepted cases saved, run -> AWAITING_APPROVAL
 *
 *   EXECUTE PHASE (executeApproved)
 *     5. Playwright runs each APPROVED case           -> PASS / FAIL / ERROR
 *     6. Failures get one clean rerun                 -> FLAKY detection
 *     7. Every non-pass creates a Finding             -> awaiting human triage
 *     8. LLM suggests a classification                -> advisory only
 *
 * Both phases run in the background. The HTTP request returns immediately and
 * the frontend polls, which is why a slow site never times out a request.
 */
@Injectable()
export class RunPipelineService {
  private readonly logger = new Logger(RunPipelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scanner: PageScannerService,
    private readonly executor: TestExecutorService,
    private readonly llm: LlmService,
    private readonly policy: PolicyService,
    private readonly secrets: SecretsService,
    private readonly config: AppConfigService,
  ) {}

  // =========================================================== PLAN PHASE

  /** Fire-and-forget. Errors are recorded on the run, never thrown at HTTP. */
  startPlanning(runId: string): void {
    void this.runPlanning(runId).catch((err) => {
      this.logger.error(`Planning crashed for run ${runId}: ${String(err)}`);
      void this.fail(runId, RunStatus.PLAN_FAILED, `Unexpected error: ${msg(err)}`);
    });
  }

  private async runPlanning(runId: string) {
    const run = await this.prisma.run.findUniqueOrThrow({
      where: { id: runId },
      include: { secret: true },
    });

    // ---------------------------------------------------- 1. scan the page
    await this.prisma.run.update({
      where: { id: runId },
      data: {
        status: RunStatus.SCANNING,
        scanStartedAt: new Date(),
        statusMessage: 'Opening the page',
      },
    });

    let snapshot;
    try {
      snapshot = await this.scanner.scan(run.targetUrl);
    } catch (err) {
      await this.fail(runId, RunStatus.SCAN_FAILED, `Could not open ${run.targetUrl}: ${msg(err)}`);
      return;
    }

    // Store the snapshot even on failure - it is the evidence for why.
    await this.prisma.run.update({
      where: { id: runId },
      data: { pageSnapshot: packJson(snapshot) },
    });

    if (!snapshot.elements.length) {
      // Be specific about WHY. "no elements found" with three possible causes
      // is a guess; the snapshot already tells us which one it was.
      const looksLikeLoadingScreen = /loading|please wait|redirecting/i.test(
        snapshot.visibleTextSample,
      );

      const reason = !snapshot.settled
        ? `The page never rendered any interactive content within ${snapshot.settleMs}ms. ` +
          (looksLikeLoadingScreen
            ? `It was still showing "${snapshot.visibleTextSample.slice(0, 60)}". ` +
              'This is a client-rendered app that paints after an auth check or data fetch - ' +
              'raise SCAN_SETTLE_TIMEOUT_MS in backend/.env and try again.'
            : 'Either it renders very late, requires a login, or blocks automated browsers. ' +
              'Raise SCAN_SETTLE_TIMEOUT_MS, or check the "What the AI saw" tab for evidence.')
        : 'The page finished rendering but exposed no labelled inputs, buttons or links. ' +
          'Controls with no accessible name cannot be targeted by name - add aria-label, a ' +
          '<label>, or data-testid attributes.';

      await this.fail(runId, RunStatus.SCAN_FAILED, reason);
      return;
    }

    await this.prisma.run.update({
      where: { id: runId },
      data: {
        status: RunStatus.PLANNING,
        planStartedAt: new Date(),
        statusMessage: `Found ${snapshot.elements.length} elements. Asking the model for test cases.`,
      },
    });

    // ------------------------------------------------ 2. ask for a test plan
    const hasCredentials = Boolean(run.secret?.emailCipher || run.secret?.passwordCipher);
    let plan;
    try {
      plan = await this.llm.generateTestPlan({
        requirements: run.requirements,
        snapshot,
        hasCredentials,
        // Credential-dependent checks are dropped when no credentials exist, so
        // the model is never asked to log in with nothing.
        checks: resolveChecks(unpackTags(run.checks)).filter(
          (c) => !c.requiresCredentials || hasCredentials,
        ),
      });
    } catch (err) {
      await this.fail(
        runId,
        RunStatus.PLAN_FAILED,
        `The model could not produce a plan: ${msg(err)}`,
      );
      return;
    }

    // --------------------------------------------------- 3. policy review
    const { accepted, rejections } = this.policy.review(
      plan.cases,
      run.targetUrl,
      run.allowDestructive,
    );

    if (rejections.length) {
      await this.prisma.policyRejection.createMany({
        data: rejections.map((r) => ({
          runId,
          stage: r.stage,
          subject: r.subject.slice(0, 500),
          reason: r.reason,
          payload: packJsonNullable(r.payload),
        })),
      });
    }

    // Requirements the model said it could not test are useful QA signal, so
    // they are recorded too - visible in the UI, never silently dropped.
    if (plan.untestable.length) {
      await this.prisma.policyRejection.createMany({
        data: plan.untestable.map((u) => ({
          runId,
          stage: 'NOT_TESTABLE',
          subject: u.requirement.slice(0, 500),
          reason: u.reason,
        })),
      });
    }
    if (plan.questions.length) {
      await this.prisma.policyRejection.createMany({
        data: plan.questions.map((q) => ({
          runId,
          stage: 'QUESTION_FOR_QA',
          subject: q.slice(0, 500),
          reason: 'The model needs this answered to test more thoroughly.',
        })),
      });
    }

    if (!accepted.length) {
      await this.fail(
        runId,
        RunStatus.PLAN_FAILED,
        `The model proposed ${plan.cases.length} case(s) but the policy engine rejected all of ` +
          'them. Open the "Rejected by policy" tab to see why.',
      );
      return;
    }

    // ----------------------------------------------------- 4. persist cases
    await this.prisma.testCase.createMany({
      data: accepted.map((c, i) => ({
        runId,
        title: c.title,
        priority: c.priority ?? 'P2',
        requirement: c.requirement,
        rationale: c.rationale,
        tags: packTags(c.tags),
        destructive: Boolean(c.destructive),
        order: i,
        steps: packJson(c.steps),
        assertions: packJson(c.assertions),
        // Nothing is pre-approved. A human decides on every case.
        approved: false,
      })),
    });

    await this.prisma.run.update({
      where: { id: runId },
      data: {
        status: RunStatus.AWAITING_APPROVAL,
        statusMessage: `${accepted.length} test case(s) ready for review.`,
        llmModel: plan.meta.model,
        llmTokensIn: plan.meta.tokensIn,
        llmTokensOut: plan.meta.tokensOut,
        llmLatencyMs: plan.meta.latencyMs,
      },
    });

    this.logger.log(
      `Run ${runId}: ${accepted.length} case(s) accepted, ${rejections.length} rejected`,
    );
  }

  // ======================================================== EXECUTE PHASE

  startExecution(runId: string): void {
    void this.executeApproved(runId).catch((err) => {
      this.logger.error(`Execution crashed for run ${runId}: ${String(err)}`);
      void this.fail(runId, RunStatus.COMPLETED, `Execution crashed: ${msg(err)}`);
    });
  }

  private async executeApproved(runId: string) {
    const run = await this.prisma.run.findUniqueOrThrow({
      where: { id: runId },
      include: {
        secret: true,
        testCases: { where: { approved: true, rejected: false }, orderBy: { order: 'asc' } },
      },
    });

    if (!run.testCases.length) {
      await this.fail(runId, RunStatus.AWAITING_APPROVAL, 'No approved test cases to run.');
      return;
    }

    // RunsService.execute already committed RUNNING and execStartedAt so the UI
    // starts polling immediately. Here we only report progress.
    await this.prisma.run.update({
      where: { id: runId },
      data: { statusMessage: `Running ${run.testCases.length} test case(s)` },
    });

    const values = this.secrets.buildRuntimeValues(run.secret);

    let index = 0;
    for (const testCase of run.testCases) {
      index++;
      await this.prisma.run.update({
        where: { id: runId },
        data: { statusMessage: `Running ${index}/${run.testCases.length}: ${testCase.title}` },
      });
      await this.runSingleCase(run, testCase, values);
    }

    // Count only the results this execution produced. Grouping over every
    // result would fold in earlier executions and report stale totals.
    const execStartedAt = await this.prisma.run
      .findUnique({ where: { id: runId }, select: { execStartedAt: true } })
      .then((r) => r?.execStartedAt ?? undefined);

    const counts = await this.prisma.testResult.groupBy({
      by: ['status'],
      where: { runId, startedAt: execStartedAt ? { gte: execStartedAt } : undefined },
      _count: true,
    });

    await this.prisma.run.update({
      where: { id: runId },
      data: {
        status: RunStatus.COMPLETED,
        finishedAt: new Date(),
        statusMessage: counts.map((c) => `${c._count} ${c.status}`).join(', ') || 'Finished',
      },
    });
  }

  /**
   * Runs one case, applies the retry policy, and persists everything.
   * Exposed so a single test can be re-run from the UI (the retest button).
   */
  async runSingleCase(
    run: Run & { secret?: { emailCipher: string | null; passwordCipher: string | null } | null },
    testCase: TestCase,
    valuesIn?: Record<string, string>,
  ) {
    const values = valuesIn ?? this.secrets.buildRuntimeValues(run.secret ?? null);

    const executable = {
      id: testCase.id,
      title: testCase.title,
      steps: unpackJson<TestStep[]>(testCase.steps, []),
      assertions: unpackJson<TestAssertion[]>(testCase.assertions, []),
    };

    // ------------------------------------------------------------ attempt 1
    const first = await this.executor.execute({
      testCase: executable,
      startUrl: run.targetUrl,
      values,
      runId: run.id,
      attempt: 1,
    });
    await this.persistResult(run.id, testCase.id, 1, first, first.status, values);

    if (first.status === 'PASS') return;

    // ------------------------------------- attempt 2 (reproducibility check)
    // A single failure is not proof. A clean rerun separates a real problem
    // from a timing artefact - the biggest single source of false bug reports.
    if (!this.config.policy.retryFailedOnce) {
      await this.createFinding(run, testCase, 1);
      return;
    }

    this.logger.log(`Re-running "${testCase.title}" in a clean context to check reproducibility`);
    const second = await this.executor.execute({
      testCase: executable,
      startUrl: run.targetUrl,
      values,
      runId: run.id,
      attempt: 2,
    });

    if (second.status === 'PASS') {
      // Passed on rerun => FLAKY, NOT pass. Recording a pass here would hide a
      // real intermittent problem.
      await this.persistResult(run.id, testCase.id, 2, second, ResultStatus.FLAKY, values);
      await this.createFinding(run, testCase, 2, true);
      return;
    }

    await this.persistResult(run.id, testCase.id, 2, second, second.status, values);
    await this.createFinding(run, testCase, 2);
  }

  // ============================================================ persistence

  private async persistResult(
    runId: string,
    testCaseId: string,
    attempt: number,
    outcome: ExecutionOutcome,
    status: string,
    values: Record<string, string>,
  ) {
    const redact = (s?: string | null) => this.secrets.redact(s, values);

    // Assertions are appended to the same timeline as the actions, offset by
    // 1000, so the UI can render one continuous list of what happened.
    const timeline: StepResult[] = [
      ...outcome.stepResults,
      ...outcome.assertionResults.map((a) => ({
        index: 1000 + a.index,
        action: `assert:${a.type}`,
        target: a.target ?? '',
        status: a.status,
        durationMs: 0,
        message:
          a.status === 'failed'
            ? (redact(a.message) ?? undefined)
            : (a.message ?? `expected ${a.expected ?? ''}`),
      })),
    ];

    return this.prisma.testResult.create({
      data: {
        runId,
        testCaseId,
        attempt,
        status,
        startedAt: outcome.startedAt,
        finishedAt: outcome.finishedAt,
        durationMs: outcome.durationMs,
        failedStepIndex: outcome.failedStepIndex,
        failedStepLabel: redact(outcome.failedStepLabel),
        expected: redact(outcome.expected),
        actual: redact(outcome.actual),
        errorType: outcome.errorType,
        errorMessage: redact(outcome.errorMessage),
        browserName: outcome.browserName,
        browserVersion: outcome.browserVersion,
        viewport: outcome.viewport,
        finalUrl: outcome.finalUrl,
        screenshotPath: outcome.screenshotPath,
        tracePath: outcome.tracePath,
        stepResults: packJson(timeline),
        consoleLogs: {
          create: outcome.console.map((c) => ({
            level: c.level,
            message: redact(c.message) ?? '',
            location: c.location,
            at: c.at,
          })),
        },
        networkLogs: {
          create: outcome.network.map((n) => ({
            method: n.method,
            url: redact(n.url) ?? '',
            status: n.status,
            statusText: n.statusText,
            resourceType: n.resourceType,
            failureText: n.failureText,
            durationMs: n.durationMs,
            isApiError: n.isApiError,
            at: n.at,
          })),
        },
      },
    });
  }

  /**
   * Creates the Finding for a failure and asks the model for a suggestion.
   *
   * Note what this does NOT do: it does not file a bug, does not set severity,
   * and does not mark anything confirmed. Status starts at NEW. A human decides.
   */
  private async createFinding(run: Run, testCase: TestCase, attempt: number, flaky = false) {
    const result = await this.prisma.testResult.findFirst({
      where: { runId: run.id, testCaseId: testCase.id, attempt },
      orderBy: { startedAt: 'desc' },
      include: { consoleLogs: true, networkLogs: true },
    });
    if (!result) return;

    const signature = buildSignature({
      testCaseId: testCase.id,
      errorType: result.errorType,
      failedStepLabel: result.failedStepLabel,
      errorMessage: result.errorMessage,
    });

    const consoleErrors = result.consoleLogs
      .filter((c) => c.level === 'ERROR')
      .map((c) => c.message);
    const apiErrors = result.networkLogs
      .filter((n) => n.isApiError || n.failureText)
      .map((n) =>
        n.failureText
          ? `${n.method} ${n.url} -> NETWORK FAILURE: ${n.failureText}`
          : `${n.method} ${n.url} -> ${n.status} ${n.statusText ?? ''}`.trim(),
      );

    // Same signature already open? Update it instead of creating a duplicate.
    const existingOpen = await this.prisma.finding.findFirst({
      where: {
        signature,
        testCaseId: testCase.id,
        status: { in: ['NEW', 'TRIAGED', 'CONFIRMED', 'REOPENED'] },
      },
    });

    if (existingOpen) {
      await this.prisma.finding.update({
        where: { id: existingOpen.id },
        data: { occurrences: { increment: 1 }, lastSeenAt: new Date() },
      });
      await this.prisma.findingEvent.create({
        data: {
          findingId: existingOpen.id,
          fromStatus: existingOpen.status,
          toStatus: existingOpen.status,
          actor: 'system',
          note: `Seen again in run "${run.name}". Occurrence #${existingOpen.occurrences + 1}.`,
        },
      });
      return;
    }

    const finding = await this.prisma.finding.create({
      data: {
        resultId: result.id,
        runId: run.id,
        testCaseId: testCase.id,
        status: 'NEW',
        signature,
        aiClassification: flaky ? Classification.FLAKY : null,
        aiEvidence: packJson({
          consoleErrors: consoleErrors.slice(0, 20),
          apiErrors: apiErrors.slice(0, 20),
          attempts: attempt,
        }),
      },
    });

    await this.prisma.findingEvent.create({
      data: {
        findingId: finding.id,
        toStatus: 'NEW',
        actor: 'system',
        note: flaky
          ? 'Failed on the first attempt and passed on the rerun - flagged as flaky.'
          : `Created from a ${result.status} result. Awaiting human triage.`,
      },
    });

    // ------------------------------------------------- LLM call #2: triage
    const steps = unpackJson<StepResult[]>(result.stepResults, []).map((s, i) => ({
      index: s.index ?? i,
      action: s.action ?? '',
      target: s.target ?? '',
      status: s.status ?? '',
      message: s.message,
    }));

    const triage = await this.llm.triageFailure({
      requirement: testCase.requirement ?? run.requirements.slice(0, 1000),
      testTitle: testCase.title,
      steps,
      failedStepLabel: result.failedStepLabel,
      errorType: result.errorType,
      errorMessage: result.errorMessage,
      expected: result.expected,
      actual: result.actual,
      finalUrl: result.finalUrl,
      consoleErrors,
      apiErrors,
      attempt,
      previousAttemptStatus: attempt > 1 ? 'FAIL' : undefined,
    });

    if (!triage) return;

    await this.prisma.finding.update({
      where: { id: finding.id },
      data: {
        aiClassification: flaky ? Classification.FLAKY : triage.classification,
        aiConfidence: triage.confidence,
        aiSummary: triage.summary,
        aiSuspectedCause: triage.suspectedCause,
        aiEvidence: packJson({
          consoleErrors: consoleErrors.slice(0, 20),
          apiErrors: apiErrors.slice(0, 20),
          attempts: attempt,
          evidenceUsed: triage.evidenceUsed,
          recommendedNextStep: triage.recommendedNextStep,
        }),
      },
    });
  }

  private async fail(runId: string, status: RunStatus, message: string) {
    this.logger.warn(`Run ${runId}: ${message}`);
    await this.prisma.run
      .update({
        where: { id: runId },
        data: { status, statusMessage: message, finishedAt: new Date() },
      })
      .catch(() => undefined);
  }
}

/**
 * Stable fingerprint for de-duplication.
 *
 * Numbers and UUIDs are stripped from the message first, so "timeout after
 * 5031ms" and "timeout after 4998ms" collapse to the same problem instead of
 * filing a new finding on every run.
 */
export function buildSignature(input: {
  testCaseId: string;
  errorType?: string | null;
  failedStepLabel?: string | null;
  errorMessage?: string | null;
}): string {
  const normalised = (input.errorMessage ?? '')
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
    .replace(/\d+/g, '<n>')
    .slice(0, 300);

  return crypto
    .createHash('sha1')
    .update(
      [input.testCaseId, input.errorType ?? '', input.failedStepLabel ?? '', normalised].join('|'),
    )
    .digest('hex');
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
