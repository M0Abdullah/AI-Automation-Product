import { Injectable, Logger } from '@nestjs/common';
import type { Run, RunPage, TestCase } from '@prisma/client';
import * as crypto from 'node:crypto';
import { PageScannerService } from '../browser/page-scanner.service';
import { SiteCrawlerService, normaliseUrl, pathOf } from '../browser/site-crawler.service';
import { TestExecutorService } from '../browser/test-executor.service';
import type { ExecutionOutcome, PageSnapshot } from '../browser/browser.types';
import type { StorageState } from '../browser/browser.factory';
import { LoginFailedError, SessionService } from '../browser/session.service';
import { BrowserFactory } from '../browser/browser.factory';
import { waitForInteractiveContent } from '../browser/page-settle';
import { compareToSpec, measurePage } from '../design/design-compare';
import { extractDesignSpec, specIsUsable } from '../design/design-spec';
import { FigmaError, FigmaService } from '../design/figma.service';
import { checksForPage, resolveChecks } from '../common/check-catalog';
import { readJson, writeJson, writeJsonNullable } from '../common/json';
import { Classification, ResultStatus, RunPageStatus, RunStatus } from '../common/enums';
import { AppConfigService } from '../config/app-config.service';
import { LlmService } from '../llm/llm.service';
import { MailService } from '../mail/mail.service';
import { PolicyService } from '../policy/policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { SecretsService } from '../secrets/secrets.service';
import type { StepResult, TestAssertion, TestStep } from '../common/test-plan.types';

/**
 * THE PIPELINE. This file is the product.
 *
 *   PLAN PHASE (startPlanning)
 *     1. Sign in once, if the app is behind a login
 *     2. Discover the pages of the app                -> RunPage[]
 *     3. Per page: Playwright scans it                -> PageSnapshot
 *     4. Per page: LLM turns requirements + snapshot   -> proposed cases
 *     5. Policy engine validates every step           -> accepted / rejected
 *     6. Accepted cases saved, run -> AWAITING_APPROVAL
 *
 *   EXECUTE PHASE (executeApproved)
 *     7. Playwright runs each APPROVED case, starting at ITS OWN page
 *     8. Failures get one clean rerun                 -> FLAKY detection
 *     9. Every non-pass creates a Finding             -> awaiting human triage
 *    10. LLM suggests a classification                -> advisory only
 *
 * WHOLE-APP MODE. Steps 3-5 loop over every page the crawler found, which is
 * what turns "test my login screen" into "test my app". One run, one approval
 * gate, one findings list.
 *
 * The loop is SEQUENTIAL, not parallel, and that is deliberate. Free-tier LLM
 * accounts are rate-limited per minute, and firing twelve planning calls at
 * once fails eleven of them with HTTP 429 - which would look to the user like
 * the platform breaking rather than a quota. Sequential is also what makes the
 * status message ("page 4 of 12") honest.
 *
 * WHAT STAYS SINGLE-PAGE: the Figma design comparison. A Figma frame is one
 * screen's design; checking a settings page against a login frame would produce
 * noise, not findings. See runDesignCheck.
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
    private readonly crawler: SiteCrawlerService,
    private readonly executor: TestExecutorService,
    private readonly session: SessionService,
    private readonly figma: FigmaService,
    private readonly browsers: BrowserFactory,
    private readonly llm: LlmService,
    private readonly policy: PolicyService,
    private readonly secrets: SecretsService,
    private readonly config: AppConfigService,
    private readonly mail: MailService,
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
    // Before anything is read, on purpose. A protected URL redirects an
    // anonymous browser to the login page, so crawling or scanning first would
    // describe the wrong page and every generated test would assert against
    // something never seen. It is also what makes the app's interior
    // DISCOVERABLE at all: signed out, a protected app is a login form with no
    // links on it, and a whole-app run would find exactly one page.
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

    // ------------------------------------------------ 1. discover the pages
    const pages = await this.discoverPages(run, storageState);
    if (!pages.length) return; // discoverPages already failed the run

    // Design comparison, fire-and-forget: it needs only a URL, it cannot change
    // the plan, and making the user wait on the Figma API before seeing their
    // test cases would be a poor trade. Started here so it overlaps the scans.
    if (run.figmaFileKey && run.figmaNodeId) {
      const target = run.designPageUrl?.trim() || run.targetUrl;
      // Attach it to the crawled page with the same URL, so the UI can say
      // WHICH page the frame was compared against.
      const page = pages.find((p) => sameUrl(p.url, target));
      void this.runDesignCheck({
        runId: run.id,
        url: target,
        pageId: page?.id,
        fileKey: run.figmaFileKey,
        nodeId: run.figmaNodeId,
        storageState,
      });
    }

    // --------------------------- 2. per page: scan, then ask for a test plan
    await this.prisma.run.update({
      where: { id: runId },
      data: {
        status: RunStatus.SCANNING,
        scanStartedAt: new Date(),
        statusMessage:
          pages.length === 1
            ? storageState
              ? 'Opening the page as a signed-in user'
              : 'Opening the page'
            : `Reading ${pages.length} pages`,
      },
    });

    const hasCredentials = Boolean(run.secret?.emailCipher || run.secret?.passwordCipher);
    const selectedChecks = resolveChecks(run.checks);

    let totalAccepted = 0;
    let totalRejected = 0;
    let scannedPages = 0;
    const llmMeta = { model: '', tokensIn: 0, tokensOut: 0, latencyMs: 0 };
    /** Snapshots kept for the wording pass, which runs after planning. */
    const forContentCheck: Array<{ page: RunPage; snapshot: PageSnapshot }> = [];

    for (const [i, page] of pages.entries()) {
      const label = pages.length === 1 ? '' : ` (page ${i + 1} of ${pages.length})`;

      // ------------------------------------------------------------ 2a. scan
      await this.prisma.runPage.update({
        where: { id: page.id },
        data: { status: RunPageStatus.SCANNING },
      });
      await this.prisma.run.update({
        where: { id: runId },
        data: { statusMessage: `Reading ${page.path}${label}` },
      });

      let snapshot: PageSnapshot;
      try {
        snapshot = await this.scanner.scan(page.url, storageState);
      } catch (err) {
        // ONE DEAD PAGE MUST NOT KILL THE RUN. On a twelve-page app a single
        // 500 or a slow route is normal; failing everything because of it
        // would make whole-app mode unusable. The page records why, and the
        // other eleven carry on.
        await this.failPage(page.id, `Could not open ${page.url}: ${msg(err)}`);
        continue;
      }

      // Store the snapshot even on failure - it is the evidence for why.
      await this.prisma.runPage.update({
        where: { id: page.id },
        data: {
          pageSnapshot: writeJson(snapshot),
          title: snapshot.title || null,
          elementCount: snapshot.elements.length,
          scannedAt: new Date(),
          status: RunPageStatus.SCANNED,
        },
      });
      if (page.isEntry) {
        // Mirrored onto the run so a single-page run's payload is unchanged and
        // the "What the AI saw" panel keeps working with no client change.
        await this.prisma.run.update({
          where: { id: runId },
          data: { pageSnapshot: writeJson(snapshot) },
        });
      }

      if (!snapshot.elements.length) {
        await this.failPage(page.id, explainEmptyScan(snapshot));
        continue;
      }
      scannedPages++;

      // -------------------------------------------------------- 2b. the plan
      // A run-wide ceiling as well as a per-page one: twelve pages at eight
      // cases each is 96 test cases, and nobody reviews 96 test cases. When
      // the budget runs out the remaining pages are marked SKIPPED rather than
      // silently ignored.
      const remaining = this.config.policy.maxTestCasesPerRun - totalAccepted;
      if (remaining <= 0) {
        await this.prisma.runPage.update({
          where: { id: page.id },
          data: {
            status: RunPageStatus.SKIPPED,
            statusMessage:
              `The run reached its ${this.config.policy.maxTestCasesPerRun}-case limit ` +
              '(MAX_TEST_CASES_PER_RUN) before this page was planned.',
          },
        });
        continue;
      }

      await this.prisma.run.update({
        where: { id: runId },
        data: {
          status: RunStatus.PLANNING,
          planStartedAt: new Date(),
          statusMessage:
            `${page.path}: found ${snapshot.elements.length} elements, ` +
            `asking the model for test cases${label}`,
        },
      });

      // Login checks only go to pages that actually have a sign-in on them -
      // otherwise eleven dashboards each get a "login works" case that fails
      // with LOCATOR_NOT_FOUND and fills the findings list with test defects.
      const pageChecks = checksForPage({
        checks: selectedChecks,
        hasCredentials,
        url: snapshot.finalUrl,
        title: snapshot.title,
        hasPasswordField: snapshot.elements.some((e) => e.type === 'password'),
      });

      let plan;
      try {
        plan = await this.llm.generateTestPlan({
          requirements: run.requirements,
          snapshot,
          hasCredentials,
          checks: pageChecks,
        });
      } catch (err) {
        await this.prisma.runPage.update({
          where: { id: page.id },
          data: {
            status: RunPageStatus.PLAN_FAILED,
            statusMessage: `The model could not produce a plan: ${msg(err)}`,
          },
        });
        continue;
      }

      llmMeta.model = plan.meta.model || llmMeta.model;
      llmMeta.tokensIn += plan.meta.tokensIn ?? 0;
      llmMeta.tokensOut += plan.meta.tokensOut ?? 0;
      llmMeta.latencyMs += plan.meta.latencyMs ?? 0;

      // ----------------------------------------------------- 2c. policy gate
      const perPage = Math.min(this.config.policy.maxTestCasesPerPage, remaining);
      const { accepted, rejections } = this.policy.review(
        plan.cases,
        page.url,
        run.allowDestructive,
        perPage,
      );

      await this.recordRejections(runId, page.url, rejections, plan);
      totalRejected += rejections.length;

      if (!accepted.length) {
        await this.prisma.runPage.update({
          where: { id: page.id },
          data: {
            status: RunPageStatus.PLAN_FAILED,
            statusMessage:
              `The model proposed ${plan.cases.length} case(s) and the policy engine ` +
              'rejected all of them. See the "Rejected by policy" tab.',
          },
        });
        continue;
      }

      await this.prisma.testCase.createMany({
        data: accepted.map((c, n) => ({
          runId,
          pageId: page.id,
          // Denormalised because the executor needs a start URL on every
          // attempt, and a hand-edited case may point somewhere the crawler
          // never visited.
          pageUrl: page.url,
          title: c.title,
          priority: c.priority ?? 'P2',
          requirement: c.requirement,
          rationale: c.rationale,
          tags: c.tags ?? [],
          destructive: Boolean(c.destructive),
          // Global order, so the UI lists page 1's cases before page 2's.
          order: totalAccepted + n,
          steps: writeJson(c.steps),
          assertions: writeJson(c.assertions),
          // Nothing is pre-approved. A human decides on every case.
          approved: false,
        })),
      });

      totalAccepted += accepted.length;
      await this.prisma.runPage.update({
        where: { id: page.id },
        data: {
          status: RunPageStatus.PLANNED,
          plannedAt: new Date(),
          statusMessage: `${accepted.length} test case(s) proposed.`,
        },
      });
      forContentCheck.push({ page, snapshot });
    }

    // ------------------------------------------------------- 3. was it worth it
    if (!totalAccepted) {
      await this.fail(
        runId,
        scannedPages ? RunStatus.PLAN_FAILED : RunStatus.SCAN_FAILED,
        scannedPages
          ? `No test cases survived review across ${pages.length} page(s). Open the ` +
              '"Rejected by policy" tab and the page list to see why.'
          : `None of the ${pages.length} page(s) could be read. See the page list for the ` +
              'reason against each one.',
      );
      return;
    }

    await this.prisma.run.update({
      where: { id: runId },
      data: {
        status: RunStatus.AWAITING_APPROVAL,
        statusMessage:
          pages.length === 1
            ? `${totalAccepted} test case(s) ready for review.`
            : `${totalAccepted} test case(s) across ${scannedPages} page(s), ready for review.`,
        llmModel: llmMeta.model || null,
        llmTokensIn: llmMeta.tokensIn || null,
        llmTokensOut: llmMeta.tokensOut || null,
        llmLatencyMs: llmMeta.latencyMs || null,
      },
    });

    this.logger.log(
      `Run ${runId}: ${totalAccepted} case(s) accepted across ${scannedPages}/${pages.length} ` +
        `page(s), ${totalRejected} rejected`,
    );

    // ------------------------------- 4. wording pass (advisory, in the background)
    // Deliberately after the plan and not awaited: it reads copy the scan
    // already captured, so it cannot influence the plan, and making the user
    // wait for a spell-check of twelve pages before seeing their test cases
    // would be a poor trade. Sequential inside, to stay under the rate limit.
    void this.runContentChecks(runId, forContentCheck);
  }

  /**
   * WHAT PAGES IS THIS RUN ABOUT?
   *
   * Single-page mode is not a special case here - it is a crawl of exactly one
   * page. That is why nothing downstream needs an `if (crawlEnabled)`: the scan,
   * the plan and the wording pass all just loop over RunPage rows.
   *
   * Returns an empty array after failing the run, so the caller can bail out.
   */
  private async discoverPages(
    run: Run,
    storageState?: StorageState,
  ): Promise<RunPage[]> {
    // A re-plan reuses the pages it already found. Re-crawling would spend
    // another minute of browser time to rediscover the same twelve URLs, and
    // worse, a nav bar that changed in the meantime would silently change what
    // the run covers - so "re-plan" would no longer mean "plan the same thing
    // again". RunsService.replan deletes the pages when a fresh crawl IS wanted.
    const existing = await this.prisma.runPage.findMany({
      where: { runId: run.id },
      orderBy: { order: 'asc' },
    });
    if (existing.length) {
      await this.prisma.runPage.updateMany({
        where: { runId: run.id },
        data: { status: RunPageStatus.DISCOVERED, statusMessage: null },
      });
      return this.prisma.runPage.findMany({
        where: { runId: run.id },
        orderBy: { order: 'asc' },
      });
    }

    if (!run.crawlEnabled) {
      const url = normaliseUrl(run.targetUrl);
      await this.prisma.runPage.create({
        data: { runId: run.id, url, path: pathOf(url), isEntry: true, order: 0, depth: 0 },
      });
      return this.prisma.runPage.findMany({ where: { runId: run.id }, orderBy: { order: 'asc' } });
    }

    await this.prisma.run.update({
      where: { id: run.id },
      data: {
        status: RunStatus.SCANNING,
        crawlStartedAt: new Date(),
        statusMessage: `Finding the pages of ${new URL(run.targetUrl).host}`,
      },
    });

    let crawl;
    try {
      crawl = await this.crawler.crawl({
        entryUrl: run.targetUrl,
        maxPages: run.maxPages,
        maxDepth: run.maxDepth,
        includePaths: run.includePaths,
        excludePaths: run.excludePaths,
        storageState,
      });
    } catch (err) {
      await this.fail(
        run.id,
        RunStatus.SCAN_FAILED,
        `Could not explore ${run.targetUrl}: ${msg(err)}`,
      );
      return [];
    }

    if (!crawl.pages.length) {
      await this.fail(
        run.id,
        RunStatus.SCAN_FAILED,
        `Nothing could be opened at ${run.targetUrl}.`,
      );
      return [];
    }

    const entry = normaliseUrl(run.targetUrl);
    await this.prisma.runPage.createMany({
      data: crawl.pages.map((p, i) => ({
        runId: run.id,
        url: p.url,
        path: p.path,
        title: p.title || null,
        isEntry: sameUrl(p.url, entry),
        discoveredFrom: p.discoveredFrom ?? null,
        depth: p.depth,
        order: i,
      })),
    });

    // Links deliberately not crawled are recorded, not dropped. "Why is
    // /admin/users missing from my run" is the first question a user asks, and
    // "signing out would destroy the run's session" is a much better answer
    // than silence.
    if (crawl.skipped.length) {
      await this.prisma.policyRejection.createMany({
        data: crawl.skipped.map((s) => ({
          runId: run.id,
          stage: 'CRAWL_SKIPPED',
          subject: s.url.slice(0, 500),
          reason: s.reason,
        })),
      });
    }
    if (crawl.truncated) {
      await this.prisma.policyRejection.create({
        data: {
          runId: run.id,
          stage: 'CRAWL_SKIPPED',
          subject: `${run.maxPages}-page limit reached`,
          reason:
            'More pages were queued than the run allows. Raise "Maximum pages" to cover ' +
            'the rest of the app.',
        },
      });
    }

    this.logger.log(`Run ${run.id}: crawl found ${crawl.pages.length} page(s)`);
    return this.prisma.runPage.findMany({ where: { runId: run.id }, orderBy: { order: 'asc' } });
  }

  /**
   * Policy rejections, untestable requirements and open questions.
   *
   * All three are recorded against the page they came from, because on a
   * twelve-page run "the model could not test this" is meaningless without
   * knowing where.
   */
  private async recordRejections(
    runId: string,
    pageUrl: string,
    rejections: Array<{ stage: string; subject: string; reason: string; payload?: unknown }>,
    plan: { untestable: Array<{ requirement: string; reason: string }>; questions: string[] },
  ) {
    if (rejections.length) {
      await this.prisma.policyRejection.createMany({
        data: rejections.map((r) => ({
          runId,
          pageUrl,
          stage: r.stage,
          subject: r.subject.slice(0, 500),
          reason: r.reason,
          payload: writeJsonNullable(r.payload),
        })),
      });
    }

    // Requirements the model said it could not test are useful QA signal, so
    // they are recorded too - visible in the UI, never silently dropped.
    if (plan.untestable.length) {
      await this.prisma.policyRejection.createMany({
        data: plan.untestable.map((u) => ({
          runId,
          pageUrl,
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
          pageUrl,
          stage: 'QUESTION_FOR_QA',
          subject: q.slice(0, 500),
          reason: 'The model needs this answered to test more thoroughly.',
        })),
      });
    }
  }

  /** Mark one page unreadable, with the reason, and leave the run alive. */
  private async failPage(pageId: string, reason: string) {
    this.logger.warn(`Page ${pageId}: ${reason}`);
    await this.prisma.runPage
      .update({
        where: { id: pageId },
        data: { status: RunPageStatus.SCAN_FAILED, statusMessage: reason },
      })
      .catch(() => undefined);
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
    const pageCount = new Set(run.testCases.map((c) => c.pageUrl ?? run.targetUrl)).size;
    await this.prisma.run.update({
      where: { id: runId },
      data: {
        statusMessage:
          pageCount > 1
            ? `Running ${run.testCases.length} test case(s) across ${pageCount} page(s)`
            : `Running ${run.testCases.length} test case(s)`,
      },
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
          data: { statusMessage: stale ? 'Session expired - signing in again' : 'Signing in' },
        });
        storageState = (await this.establishSession(run)) ?? undefined;
        if (!storageState) return; // establishSession already failed the run
      }
    }

    let index = 0;
    /** Cases abandoned by an unexpected error, reported at the end. */
    const aborted: Array<{ title: string; reason: string }> = [];

    for (const testCase of run.testCases) {
      index++;
      await this.prisma.run.update({
        where: { id: runId },
        data: {
          statusMessage:
            `Running ${index}/${run.testCases.length}: ${testCase.title}` +
            (pageCount > 1 && testCase.pageUrl ? ` — ${pathOf(testCase.pageUrl)}` : ''),
        },
      });

      // ONE TEST MUST NOT TAKE DOWN THE SUITE.
      //
      // runSingleCase handles browser and assertion failures itself - those are
      // test RESULTS, not errors. What lands here is the unexpected kind: a
      // database write rejected, the LLM triage call throwing, a disk full.
      // Without this boundary the first such error escapes to startExecution's
      // catch, which marks the run COMPLETED - so a 6-test run reports "2 of 6"
      // and looks finished, with four tests silently never attempted and no
      // indication anything went wrong. That is the worst possible failure mode
      // for a QA tool: it under-reports and looks healthy doing it.
      //
      // Same rule the crawl already follows for a dead page.
      try {
        await this.runSingleCase(run, testCase, values, storageState);
      } catch (err) {
        const reason = msg(err);
        aborted.push({ title: testCase.title, reason });
        this.logger.error(`"${testCase.title}" could not be run: ${reason}`);

        // Recorded as an ERROR result so the case does not just sit blank in
        // the UI. A test with no result reads as "not run yet"; this one WAS
        // attempted and could not complete, and those are different facts.
        await this.recordAbortedCase(run.id, testCase.id, reason).catch(() => undefined);
      }
    }

    // ONE COUNT PER TEST, NOT PER RESULT ROW.
    //
    // A failed test writes TWO rows - the first attempt and the automatic
    // reproducibility rerun. Grouping over rows therefore reported three failed
    // tests as "6 FAIL", which reads as nine tests in a six-test run. In a tool
    // whose entire value is numbers people can trust, a status line that
    // inflates the failure count is not a cosmetic bug.
    //
    // So the LATEST result per case is what counts - the same rule the run page
    // and the summary email already use, which is what keeps the three of them
    // from disagreeing. It also gets FLAKY right: a FAIL followed by a passing
    // rerun must report FLAKY, and neither PASS nor FAIL.
    const execStartedAt = await this.prisma.run
      .findUnique({ where: { id: runId }, select: { execStartedAt: true } })
      .then((r) => r?.execStartedAt ?? undefined);

    const executedCases = await this.prisma.testCase.findMany({
      where: { runId, approved: true, rejected: false },
      select: {
        results: {
          where: { startedAt: execStartedAt ? { gte: execStartedAt } : undefined },
          orderBy: { startedAt: 'asc' },
          select: { status: true },
        },
      },
    });

    const tally = new Map<string, number>();
    for (const tc of executedCases) {
      if (!tc.results.length) continue;
      const status = tc.results[tc.results.length - 1].status;
      tally.set(status, (tally.get(status) ?? 0) + 1);
    }
    const counts = [...tally.entries()].map(([status, count]) => ({ status, count }));

    // The run is over, so the session cookie has no further purpose. Wiped
    // before the status flips, so no window exists where a COMPLETED run still
    // holds live credentials for the site under test.
    await this.wipeSession(runId);

    const summary = counts.map((c) => `${c.count} ${c.status}`).join(', ') || 'Finished';

    await this.prisma.run.update({
      where: { id: runId },
      data: {
        status: RunStatus.COMPLETED,
        finishedAt: new Date(),
        // Anything abandoned is named in the status, never hidden behind a
        // tidy-looking pass/fail count.
        statusMessage: aborted.length
          ? `${summary}. ${aborted.length} test(s) could not be run: ${aborted
              .map((a) => `"${a.title}" (${a.reason})`)
              .join('; ')
              .slice(0, 600)}`
          : summary,
      },
    });

    // Told AFTER the status flips, so the link in the email opens a finished
    // run rather than one that still says "running".
    this.notifyRunFinished(runId);
  }

  /**
   * EMAIL THE PERSON WHO STARTED THE RUN.
   *
   * This is the "tell me when my audit is done" notification, and it is the
   * reason a run is worth starting and walking away from — a browser tab nobody
   * is watching is not a report.
   *
   * Fire-and-forget, and every failure is swallowed: a mail outage must never
   * lose a completed run's results. It is sent only for a finished EXECUTION,
   * not when planning completes, because a plan awaiting approval already sends
   * the user back to the app to act.
   */
  private notifyRunFinished(runId: string): void {
    if (!this.config.mail.onRunFinished) return;

    void (async () => {
      try {
        const run = await this.prisma.run.findUnique({
          where: { id: runId },
          include: {
            createdBy: { select: { name: true, email: true } },
            pages: { select: { status: true } },
            testCases: {
              select: { approved: true, rejected: true, results: { select: { status: true } } },
            },
            findings: { select: { status: true } },
            _count: { select: { contentIssues: true, designIssues: true } },
          },
        });
        // No account behind the run means nobody to tell. Anonymous runs are
        // possible on an old row, so this is a real case, not a guard.
        if (!run?.createdBy?.email) return;

        // The LATEST result per case is the one that counts: a FAIL followed by
        // a FLAKY pass must report FLAKY, and a re-executed run must report its
        // newest outcome rather than a stale one. Same rule as the run page, so
        // the email and the screen can never disagree.
        const latest = run.testCases.map((tc) =>
          tc.results.length ? tc.results[tc.results.length - 1].status : null,
        );

        await this.mail.sendRunFinished({
          to: run.createdBy.email,
          name: run.createdBy.name,
          runId: run.id,
          runName: run.name,
          targetUrl: run.targetUrl,
          wholeApp: run.crawlEnabled,
          summary: {
            totalPages: run.pages.length,
            pagesFailed: run.pages.filter(
              (p) => p.status === RunPageStatus.SCAN_FAILED || p.status === RunPageStatus.PLAN_FAILED,
            ).length,
            totalCases: run.testCases.length,
            executed: latest.filter(Boolean).length,
            passed: latest.filter((x) => x === ResultStatus.PASS).length,
            failed: latest.filter((x) => x === ResultStatus.FAIL).length,
            flaky: latest.filter((x) => x === ResultStatus.FLAKY).length,
            errored: latest.filter((x) => x === ResultStatus.ERROR).length,
            openFindings: run.findings.filter((f) =>
              ['NEW', 'TRIAGED', 'REOPENED'].includes(f.status),
            ).length,
          },
          contentIssues: run._count.contentIssues,
          designIssues: run._count.designIssues,
        });
      } catch (err) {
        this.logger.warn(`Could not send the run-finished email for ${runId}: ${String(err)}`);
      }
    })();
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
      steps: readJson<TestStep[]>(testCase.steps, []),
      assertions: readJson<TestAssertion[]>(testCase.assertions, []),
    };

    // THE CASE'S OWN PAGE, not the run's entry URL. This one line is what makes
    // a whole-app run actually test the whole app: without it every test would
    // start at the front door and immediately fail to find the elements it was
    // written against. Falls back to the entry URL for cases written before
    // whole-app mode, and for hand-written ones with no page.
    const startUrl = testCase.pageUrl ?? run.targetUrl;

    // ------------------------------------------------------------ attempt 1
    const first = await this.executor.execute({
      testCase: executable,
      startUrl,
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
      startUrl,
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

  /**
   * Record a case that could not be executed at all.
   *
   * Deliberately a real TestResult row with status ERROR rather than a log
   * line. A case with no result renders as "not run yet", which is a different
   * and much more comforting claim than "we tried and something broke" - and on
   * a suite that reports itself COMPLETED, the difference is the whole story.
   */
  private async recordAbortedCase(runId: string, testCaseId: string, reason: string) {
    const now = new Date();
    await this.prisma.testResult.create({
      data: {
        runId,
        testCaseId,
        attempt: 1,
        status: ResultStatus.ERROR,
        startedAt: now,
        finishedAt: now,
        durationMs: 0,
        errorType: 'UNKNOWN',
        errorMessage: `The platform could not run this test: ${reason}`.slice(0, 2000),
        stepResults: writeJson([]),
      },
    });
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
        stepResults: writeJson(timeline),
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

    // ONE FINDING PER RESULT.
    //
    // This used to be a unique index on Finding.resultId. That index had to go
    // (it rejected every CONTENT and DESIGN finding, which legitimately have no
    // result - see schema.prisma), so the rule is enforced here instead. Cheap:
    // resultId still carries a plain index.
    const already = await this.prisma.finding.findFirst({
      where: { resultId: result.id },
      select: { id: true },
    });
    if (already) {
      this.logger.debug(`Result ${result.id} already has a finding; not creating a second.`);
      return;
    }

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
        aiEvidence: writeJson({
          consoleErrors: consoleErrors.slice(0, 20),
          apiErrors: apiErrors.slice(0, 20),
          attempts: attempt,
          // Which page broke. On a twelve-page run this is the first thing a
          // triager needs, and it is not derivable from the test title.
          pageUrl: testCase.pageUrl ?? run.targetUrl,
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
    const steps = readJson<StepResult[]>(result.stepResults, []).map((s, i) => ({
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
        aiEvidence: writeJson({
          consoleErrors: consoleErrors.slice(0, 20),
          apiErrors: apiErrors.slice(0, 20),
          attempts: attempt,
          pageUrl: testCase.pageUrl ?? run.targetUrl,
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
   * Compare ONE live page against a Figma design.
   *
   * SINGLE-PAGE ON PURPOSE, and it stays that way even now that a run can cover
   * a whole app. A Figma frame is one screen's design: the user points at the
   * login frame because they want the login page checked. Running the same
   * frame against twelve pages would report the dashboard's every button as
   * violating the login design - a wall of confident, wrong findings. The rest
   * of the run goes wide; this check goes deep on the page it was given.
   *
   * Reads the design as a SPECIFICATION - the button and control heights, radii,
   * type scale, weights, colour palettes, icon sizes and spacing scale it
   * permits - and checks the page for conformance, rather than trying to pair
   * each Figma layer with one element. Layer names in a real design system look
   * like "Color=Brand, Size=base, State=Initial" while the live button says
   * "Pricing & FAQ"; there is nothing to pair on.
   *
   * Advisory, like the wording pass: a difference is not proof of a mistake, so
   * a human promotes these rather than the platform filing them.
   */
  private async runDesignCheck(args: {
    runId: string;
    url: string;
    pageId?: string;
    fileKey: string;
    nodeId: string;
    storageState?: StorageState;
  }): Promise<void> {
    const { runId, url, pageId, fileKey, nodeId, storageState } = args;
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
          // Raised from 60: eleven properties are checked now, not four, so the
          // same page legitimately produces more. Still capped, because the list
          // is read rather than processed.
          data: cmp.deviations.slice(0, 150).map((d) => ({
            runId,
            pageId: pageId ?? null,
            pageUrl: url,
            property: d.property,
            group: d.group,
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
      const groups = Object.entries(cmp.byGroup)
        .sort((a, b) => b[1] - a[1])
        .map(([g, n]) => `${n} ${g.toLowerCase()}`)
        .join(', ');

      await this.prisma.run.update({
        where: { id: runId },
        data: {
          designSpecSummary:
            `${spec.nodeName} in "${spec.fileName}" - ${spec.sampled.nodes} layers. ` +
            `Heights ${spec.buttonHeights.join('/')}px, radii ${spec.cornerRadii.join('/')}px, ` +
            `type ${spec.fontSizes.join('/')}px, ` +
            `${spec.textColors.length + spec.colors.length} colours, ` +
            `icons ${spec.iconSizes.join('/') || '—'}px, ` +
            `spacing ${spec.spacings.join('/') || '—'}px. ` +
            `Compared against ${pathOf(url)}: ${cmp.conforming} value(s) matched, ` +
            `${cmp.deviations.length} deviation(s) across ${cmp.checked} element(s)` +
            (groups ? ` (${groups}).` : '.'),
        },
      });
      this.logger.log(
        `Design check on ${runId}: ${cmp.deviations.length} deviation(s), ${cmp.conforming} matches`,
      );
    } catch (err) {
      const detail = err instanceof FigmaError ? `${err.message} ${err.hint}` : String(err);
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
   * The wording pass, across every page that was planned.
   *
   * ADVISORY. These are stored as ContentIssue rows, never as Findings, so they
   * cannot fail a test or take a BUG id. Low-confidence rows are dropped here
   * rather than in the UI - a list nobody trusts is worse than a shorter list.
   *
   * Sequential across pages, for the same rate-limit reason planning is.
   */
  private async runContentChecks(
    runId: string,
    pages: Array<{ page: RunPage; snapshot: PageSnapshot }>,
  ): Promise<void> {
    for (const { page, snapshot } of pages) {
      await this.runContentCheck(runId, page, snapshot);
    }
  }

  private async runContentCheck(
    runId: string,
    page: RunPage,
    snapshot: PageSnapshot,
  ): Promise<void> {
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
        this.logger.log(`Content check on ${page.path}: nothing worth reporting`);
        return;
      }

      await this.prisma.contentIssue.createMany({
        data: worth.map((i) => ({
          runId,
          pageId: page.id,
          pageUrl: page.url,
          kind: i.kind,
          text: i.text.trim().slice(0, 300),
          suggestion: i.suggestion?.trim() || null,
          reason: i.reason?.trim() || null,
          confidence: i.confidence,
          whereSeen: i.whereSeen?.trim() || null,
        })),
      });
      this.logger.log(`Content check on ${page.path}: stored ${worth.length} issue(s)`);
    } catch (err) {
      // Never allowed to affect the run.
      this.logger.warn(`Content check on ${page.path} failed: ${String(err)}`);
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
 * WHY THIS PAGE PRODUCED NOTHING.
 *
 * Three different causes look identical from the outside, and the snapshot
 * already knows which one it was - so the message names it instead of listing
 * possibilities and leaving the user to guess.
 */
function explainEmptyScan(snapshot: PageSnapshot): string {
  const looksLikeLoadingScreen = /loading|please wait|redirecting/i.test(
    snapshot.visibleTextSample,
  );

  if (!snapshot.settled) {
    return (
      `The page never rendered any interactive content within ${snapshot.settleMs}ms. ` +
      (looksLikeLoadingScreen
        ? `It was still showing "${snapshot.visibleTextSample.slice(0, 60)}". ` +
          'This is a client-rendered app that paints after an auth check or data fetch - ' +
          'raise SCAN_SETTLE_TIMEOUT_MS in backend/.env and try again.'
        : 'Either it renders very late, requires a login, or blocks automated browsers. ' +
          'Raise SCAN_SETTLE_TIMEOUT_MS, or check the "What the AI saw" tab for evidence.')
    );
  }
  return (
    'The page finished rendering but exposed no labelled inputs, buttons or links. ' +
    'Controls with no accessible name cannot be targeted by name - add aria-label, a ' +
    '<label>, or data-testid attributes.'
  );
}

/** Same page? Compared after normalisation, so /users and /users/ match. */
function sameUrl(a: string, b: string): boolean {
  try {
    return normaliseUrl(a) === normaliseUrl(b);
  } catch {
    return a === b;
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
