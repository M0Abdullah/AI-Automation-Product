import { Injectable, Logger } from '@nestjs/common';
import type { Run, TestCase } from '@prisma/client';
import * as crypto from 'node:crypto';
import { PageScannerService } from '../browser/page-scanner.service';
import { TestExecutorService } from '../browser/test-executor.service';
import type { ExecutionOutcome, PageSnapshot } from '../browser/browser.types';
import type { StorageState } from '../browser/browser.factory';
import { LoginFailedError, SessionService } from '../browser/session.service';
import { BrowserFactory } from '../browser/browser.factory';
import { waitForInteractiveContent } from '../browser/page-settle';
import { compareToSpec, measurePage } from '../design/design-compare';
import { extractDesignSpec, specIsUsable } from '../design/design-spec';
import { FigmaError, FigmaService } from '../design/figma.service';
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
  /** 30 minutes. Comfortably inside a typical session lifetime. */
  private static readonly SESSION_MAX_AGE_MS = 30 * 60 * 1000;

  private readonly logger = new Logger(RunPipelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scanner: PageScannerService,
    private readonly executor: TestExecutorService,
    private readonly session: SessionService,
    private readonly figma: FigmaService,
    private readonly browsers: BrowserFactory,
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

    // ------------------------------------------- 0. sign in, if asked to
    // Before the scan on purpose. A protected URL redirects an anonymous
    // browser to the login page, so scanning first would describe the wrong
    // page and every generated test would assert against something never seen.
    let storageState: StorageState | undefined;
    if (run.loginUrl) {
      await this.prisma.run.update({
        where: { id: runId },
        data: { status: RunStatus.SCANNING, statusMessage: 'Signing in' },
      });
      const established = await this.establishSession(run);
      if (!established) return; // establishSession already failed the run
      storageState = established;
    }

    // ---------------------------------------------------- 1. scan the page
    await this.prisma.run.update({
      where: { id: runId },
      data: {
        status: RunStatus.SCANNING,
        scanStartedAt: new Date(),
        statusMessage: storageState ? 'Opening the page as a signed-in user' : 'Opening the page',
      },
    });

    let snapshot;
    try {
      snapshot = await this.scanner.scan(run.targetUrl, storageState);
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

    // -------------------------------- 1b. content pass (advisory, fire and forget)
    // Deliberately not awaited: it reads the copy the scan already captured, so
    // it cannot influence the plan, and making the user wait for a spell-check
    // before seeing their test cases would be a poor trade. Failures inside are
    // swallowed by the service.
    void this.runContentCheck(runId, snapshot);

    // Design comparison, also fire-and-forget and for the same reason: it needs
    // only the URL, it cannot change the plan, and making the user wait on the
    // Figma API before seeing their test cases would be a poor trade.
    if (run.figmaFileKey && run.figmaNodeId) {
      void this.runDesignCheck(run.id, run.targetUrl, run.figmaFileKey, run.figmaNodeId, storageState);
    }

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

    // Reuse the sign-in captured before the scan. Approval can happen hours
    // later, so the session may have expired in the meantime - if it has, sign
    // in again rather than running every test as an anonymous visitor.
    let storageState = this.loadSession(run.secret);
    if (run.loginUrl) {
      const stale = this.sessionIsStale(run.secret?.sessionCreatedAt ?? null);
      if (!storageState || stale) {
        await this.prisma.run.update({
          where: { id: runId },
          data: {
            statusMessage: stale ? 'Session expired - signing in again' : 'Signing in',
          },
        });
        storageState = (await this.establishSession(run)) ?? undefined;
        if (!storageState) return; // establishSession already failed the run
      }
    }

    let index = 0;
    for (const testCase of run.testCases) {
      index++;
      await this.prisma.run.update({
        where: { id: runId },
        data: { statusMessage: `Running ${index}/${run.testCases.length}: ${testCase.title}` },
      });
      await this.runSingleCase(run, testCase, values, storageState);
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

    // The run is over, so the session cookie has no further purpose. Wiped
    // before the status flips, so no window exists where a COMPLETED run still
    // holds live credentials for the site under test.
    await this.wipeSession(runId);

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
    /**
     * The run's shared sign-in. Passed in rather than loaded here so a run of
     * 20 tests decrypts it once instead of 20 times, and so a single retest of
     * one case can still be given a freshly established session.
     */
    storageState?: StorageState,
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
      storageState,
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
      storageState,
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
        aiCategory: triage.category,
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

  /**
   * Compare the live page against a Figma design.
   *
   * Reads the design as a SPECIFICATION - the button heights, radii, type sizes
   * and fonts it permits - and checks the page for conformance, rather than
   * trying to pair each Figma layer with one element. Layer names in a real
   * design system look like "Color=Brand, Size=base, State=Initial" while the
   * live button says "Pricing & FAQ"; there is nothing to pair on, and an app
   * page rarely mirrors a design frame anyway.
   *
   * Advisory, like the content pass: a difference is not proof of a mistake,
   * so a human promotes these rather than the platform filing them.
   */
  private async runDesignCheck(
    runId: string,
    url: string,
    fileKey: string,
    nodeId: string,
    storageState?: StorageState,
  ): Promise<void> {
    try {
      const [fileName, root] = await Promise.all([
        this.figma.fileName(fileKey),
        this.figma.getNode(fileKey, nodeId, 4),
      ]);

      const spec = extractDesignSpec({ root, fileKey, fileName });
      const usable = specIsUsable(spec);
      if (!usable.ok) {
        await this.prisma.run.update({
          where: { id: runId },
          data: { designSpecSummary: `Design not usable: ${usable.reason}` },
        });
        return;
      }

      // A fresh context, and the run's session if it has one - a design check on
      // a page behind a login must see the same page the tests will.
      const context = await this.browsers.newContext(storageState);
      let measured;
      try {
        const page = await context.newPage();
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await waitForInteractiveContent(page, {
          timeoutMs: this.config.browser.settleTimeout,
          pollMs: this.config.browser.settlePoll,
          graceMs: this.config.browser.settleGrace,
        });
        measured = await measurePage(page);
      } finally {
        await context.close().catch(() => undefined);
      }

      const cmp = compareToSpec(measured, spec);

      if (cmp.deviations.length) {
        await this.prisma.designIssue.createMany({
          data: cmp.deviations.slice(0, 60).map((d) => ({
            runId,
            property: d.property,
            element: d.element.slice(0, 200),
            selector: d.selector.slice(0, 200),
            actual: d.actual,
            expected: d.expected,
            offBy: d.offBy,
            note: d.note,
          })),
        });
      }

      // The summary carries the CONFORMING count too. "7 deviations" alone reads
      // as a broken page; "7 out of 307 checks" reads as a mostly-correct one,
      // and the second is the honest framing.
      await this.prisma.run.update({
        where: { id: runId },
        data: {
          designSpecSummary:
            `${spec.nodeName} in "${spec.fileName}" - ${spec.sampled.nodes} layers. ` +
            `Heights ${spec.buttonHeights.join('/')}px, radii ${spec.cornerRadii.join('/')}px, ` +
            `type ${spec.fontSizes.join('/')}px. ` +
            `${cmp.conforming} value(s) matched, ${cmp.deviations.length} deviation(s) ` +
            `across ${cmp.checked} element(s).`,
        },
      });
      this.logger.log(
        `Design check on ${runId}: ${cmp.deviations.length} deviation(s), ${cmp.conforming} matches`,
      );
    } catch (err) {
      const detail =
        err instanceof FigmaError ? `${err.message} ${err.hint}` : String(err);
      this.logger.warn(`Design check on ${runId} failed: ${detail}`);
      await this.prisma.run
        .update({
          where: { id: runId },
          data: { designSpecSummary: `Design check failed: ${detail.slice(0, 400)}` },
        })
        .catch(() => undefined);
    }
  }

  /**
   * The content pass: wording problems in the page's own text.
   *
   * ADVISORY. These are stored as ContentIssue rows, never as Findings, so they
   * cannot fail a test or take a BUG id. Low-confidence rows are dropped here
   * rather than in the UI - a list nobody trusts is worse than a shorter list.
   */
  private async runContentCheck(runId: string, snapshot: PageSnapshot): Promise<void> {
    try {
      const labels = snapshot.elements
        .map((e) => (e.label ?? '').trim())
        .filter((l) => l.length > 0 && l.length <= 120);

      const { issues } = await this.llm.checkContent({
        url: snapshot.finalUrl,
        title: snapshot.title,
        headings: snapshot.headings ?? [],
        elementLabels: Array.from(new Set(labels)),
        // The structure-preserving sample, not the flattened one: collapsing
        // newlines glues a heading onto the next paragraph and the editor then
        // reports punctuation bugs that are not on the page.
        visibleTextSample: snapshot.contentTextSample ?? snapshot.visibleTextSample ?? '',
      });

      // 0.5 is the floor for showing anything at all. Below that the model is
      // usually guessing at a brand name, which is the one failure mode that
      // makes a reviewer abandon the whole list.
      const worth = issues.filter((i) => i.confidence >= 0.5 && i.text.trim().length > 0);
      if (!worth.length) {
        this.logger.log(`Content check on ${runId}: nothing worth reporting`);
        return;
      }

      await this.prisma.contentIssue.createMany({
        data: worth.map((i) => ({
          runId,
          kind: i.kind,
          text: i.text.trim().slice(0, 300),
          suggestion: i.suggestion?.trim() || null,
          reason: i.reason?.trim() || null,
          confidence: i.confidence,
          whereSeen: i.whereSeen?.trim() || null,
        })),
      });
      this.logger.log(`Content check on ${runId}: stored ${worth.length} issue(s)`);
    } catch (err) {
      // Never allowed to affect the run.
      this.logger.warn(`Content check on ${runId} failed: ${String(err)}`);
    }
  }

  /**
   * Sign in for this run and persist the resulting browser state.
   *
   * Returns undefined after failing the run, so callers can simply bail out.
   * A sign-in that does not work must stop the run: continuing would generate a
   * full suite against a login page and then blame the application for it, which
   * is precisely the false-bug-report failure this platform exists to avoid.
   */
  private async establishSession(
    run: Run & { secret?: { emailCipher: string | null; passwordCipher: string | null } | null },
  ): Promise<StorageState | undefined> {
    if (!run.loginUrl) return undefined;

    const values = this.secrets.buildRuntimeValues(run.secret ?? null);
    const email = values.test_email;
    const password = values.test_password;

    if (!email || !password) {
      await this.fail(
        run.id,
        RunStatus.SCAN_FAILED,
        'A sign-in URL was given but no test credentials were saved with this run. ' +
          'Add the test email and password, or clear the sign-in URL to test the page ' +
          'as an anonymous visitor.',
      );
      return undefined;
    }

    try {
      const result = await this.session.establish({
        loginUrl: run.loginUrl,
        email,
        password,
        emailField: run.loginEmailField ?? undefined,
        passwordField: run.loginPassField ?? undefined,
        submitButton: run.loginSubmit ?? undefined,
      });

      await this.prisma.runSecret.upsert({
        where: { runId: run.id },
        create: {
          runId: run.id,
          sessionCipher: this.secrets.encrypt(JSON.stringify(result.storageState)),
          sessionCreatedAt: new Date(),
        },
        update: {
          sessionCipher: this.secrets.encrypt(JSON.stringify(result.storageState)),
          sessionCreatedAt: new Date(),
        },
      });

      await this.prisma.run.update({
        where: { id: run.id },
        data: { sessionEvidence: `${result.evidence} (${result.durationMs} ms)` },
      });

      return result.storageState;
    } catch (err) {
      // A login failure is a setup problem, not a test result. Say what to do
      // about it rather than surfacing a stack trace.
      const detail =
        err instanceof LoginFailedError
          ? `Could not sign in at ${run.loginUrl}. ${err.message} ${err.hint}`
          : `Could not sign in at ${run.loginUrl}: ${msg(err)}`;
      await this.fail(run.id, RunStatus.SCAN_FAILED, detail);
      return undefined;
    }
  }

  /** Decrypt the stored sign-in, or undefined if there is none or it is corrupt. */
  private loadSession(secret?: { sessionCipher: string | null } | null): StorageState | undefined {
    if (!secret?.sessionCipher) return undefined;
    try {
      return JSON.parse(this.secrets.decrypt(secret.sessionCipher)) as StorageState;
    } catch {
      // A key rotation or a truncated row should mean "sign in again", not a
      // crashed run.
      this.logger.warn('Stored session could not be decrypted - a fresh sign-in will be used');
      return undefined;
    }
  }

  /**
   * Sessions are re-established rather than trusted indefinitely.
   *
   * Approval is a human step, so a run can sit for hours between the scan and
   * execution. Most applications expire a session well inside that window, and
   * running with a dead cookie looks exactly like "the app logged me out",
   * which would be reported as a product bug.
   */
  private sessionIsStale(createdAt: Date | null): boolean {
    if (!createdAt) return true;
    return Date.now() - createdAt.getTime() > RunPipelineService.SESSION_MAX_AGE_MS;
  }

  /**
   * Delete the stored session once a run is over.
   *
   * A live session cookie is as sensitive as the password that produced it, and
   * a finished run has no reason to keep one. The credentials stay - a rerun
   * needs them to sign in again.
   */
  private async wipeSession(runId: string): Promise<void> {
    await this.prisma.runSecret
      .updateMany({
        where: { runId },
        data: { sessionCipher: null, sessionCreatedAt: null },
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
