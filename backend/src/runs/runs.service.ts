import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { resolveChecks } from '../common/check-catalog';
import { normaliseUrl } from '../browser/site-crawler.service';
import { OPEN_FINDING_STATUSES, RunStatus } from '../common/enums';
import { AppConfigService } from '../config/app-config.service';
import { PolicyService } from '../policy/policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { SecretsService } from '../secrets/secrets.service';
import { CreateRunDto } from './dto/create-run.dto';
import { RunPipelineService } from './run-pipeline.service';

@Injectable()
export class RunsService {
  private readonly logger = new Logger(RunsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly pipeline: RunPipelineService,
    private readonly secrets: SecretsService,
    private readonly policy: PolicyService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Creates the run and kicks off the plan phase in the background.
   * Returns immediately so the UI can navigate to the run page and poll.
   */
  async create(dto: CreateRunDto, createdById?: string) {
    if (!dto.authorized) {
      throw new BadRequestException(
        'You must confirm that you are authorised to test this website before a run can start.',
      );
    }

    // A run needs SOME statement of intent, from either source. Without one the
    // model has nothing to test and would be forced to invent expectations.
    const checks = resolveChecks(dto.checks ?? []);
    const requirements = dto.requirements?.trim() ?? '';
    if (!checks.length && requirements.length < 10) {
      throw new BadRequestException(
        'Tick at least one check, or describe what should work in the requirements box.',
      );
    }

    // SSRF guard: refuse cloud metadata endpoints outright.
    const parsed = new URL(dto.url);
    if (this.policy.isPrivateHost(parsed.hostname)) {
      throw new BadRequestException(
        `Refusing to scan ${parsed.hostname}: it is a private or metadata address.`,
      );
    }

    // A sign-in URL with nothing to sign in with would fail deep inside the
    // pipeline. Rejecting it here turns a confusing mid-run failure into a
    // clear message on the form.
    if (dto.loginUrl && !dto.credentials?.email && !dto.credentials?.password) {
      throw new BadRequestException(
        'A sign-in URL was given but no test credentials. Add the test email and ' +
          'password, or leave the sign-in URL empty to test the page as a visitor.',
      );
    }

    // The sign-in must belong to the same site being tested. Otherwise this
    // becomes a credential-submission tool pointed at arbitrary hosts.
    if (dto.loginUrl) {
      const loginHost = new URL(dto.loginUrl).origin;
      if (loginHost !== parsed.origin) {
        throw new BadRequestException(
          `The sign-in URL must be on the same site as the page under test. ` +
            `Target is ${parsed.origin}, sign-in is ${loginHost}.`,
        );
      }
    }

    // The design page, when given, must be part of the same app. Otherwise the
    // Figma comparison silently measures somebody else's site.
    if (dto.designPageUrl) {
      const designOrigin = new URL(dto.designPageUrl).origin;
      if (designOrigin !== parsed.origin) {
        throw new BadRequestException(
          `The design page must be on the site under test. Target is ${parsed.origin}, ` +
            `the design page is ${designOrigin}.`,
        );
      }
    }

    // WHOLE-APP SCOPE, clamped server-side.
    //
    // The UI offers sensible numbers, but the ceiling is enforced here because
    // the cost is real: every page is a browser scan plus an LLM call, so a
    // crafted request asking for 10,000 pages would spend hours of browser time
    // and an entire API quota.
    const crawlEnabled = Boolean(dto.crawlEnabled);
    const { defaultMaxPages, defaultMaxDepth, maxPagesHard, maxDepthHard } = this.config.crawl;
    const maxPages = clamp(dto.maxPages ?? defaultMaxPages, 1, maxPagesHard);
    const maxDepth = clamp(dto.maxDepth ?? defaultMaxDepth, 1, maxDepthHard);

    const project = await this.projects.findOrCreateForUrl(dto.url, dto.name);

    const run = await this.prisma.run.create({
      data: {
        projectId: project.id,
        name: dto.name?.trim() || defaultRunName(dto.url, crawlEnabled),
        targetUrl: dto.url,
        requirements: requirements,
        checks: checks.map((c) => c.id),
        authorized: dto.authorized,
        allowDestructive: Boolean(dto.allowDestructive),
        // Whole-app scope.
        crawlEnabled,
        maxPages,
        maxDepth,
        includePaths: cleanPaths(dto.includePaths),
        excludePaths: cleanPaths(dto.excludePaths),
        // Sign-in configuration. Trimmed to null rather than kept as '' so
        // `if (run.loginUrl)` is a reliable "should we sign in" test.
        loginUrl: dto.loginUrl?.trim() || null,
        loginEmailField: dto.loginEmailField?.trim() || null,
        loginPassField: dto.loginPassField?.trim() || null,
        loginSubmit: dto.loginSubmit?.trim() || null,
        // Accept a whole Figma URL as well as a bare key - people paste the URL.
        figmaFileKey: parseFigmaFileKey(dto.figmaFileKey),
        figmaNodeId: normaliseNodeId(dto.figmaNodeId),
        // Which single page the Figma frame describes. Defaults to the entry
        // URL, which is the right answer for a single-page run and the most
        // likely one for a whole-app run - the user pasted both together.
        designPageUrl: dto.designPageUrl?.trim() ? normaliseUrl(dto.designPageUrl.trim()) : null,
        status: RunStatus.CREATED,
        statusMessage: 'Queued',
        // WHO started this run. Without it every run is anonymous and everyone
        // sees everyone else's work, which is what "scope" below fixes.
        createdById: createdById ?? null,
        secret:
          dto.credentials?.email || dto.credentials?.password
            ? {
                create: {
                  emailCipher: dto.credentials.email
                    ? this.secrets.encrypt(dto.credentials.email)
                    : null,
                  passwordCipher: dto.credentials.password
                    ? this.secrets.encrypt(dto.credentials.password)
                    : null,
                },
              }
            : undefined,
      },
    });

    this.pipeline.startPlanning(run.id);
    this.logger.log(`Run ${run.id} created for ${dto.url}`);
    return run;
  }

  /**
   * WHO SEES WHAT.
   *
   * Default is 'mine': your runs only. A shared workspace where every QA sees
   * every other QA's target URLs is confusing and leaks which sites colleagues
   * are testing. 'team' is still available on purpose - shared history is the
   * point of a team tool - but you have to ask for it.
   */
  findAll(scope: 'mine' | 'team', userId: string) {
    return this.prisma.run.findMany({
      where: scope === 'mine' ? { createdById: userId } : {},
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        name: true,
        targetUrl: true,
        status: true,
        statusMessage: true,
        createdAt: true,
        finishedAt: true,
        createdBy: { select: { id: true, name: true, email: true } },
        project: { select: { id: true, name: true } },
        crawlEnabled: true,
        // Page count is what tells a whole-app run apart from a single-page one
        // at a glance, so the list needs it.
        _count: { select: { testCases: true, findings: true, pages: true } },
      },
    });
  }

  /** Everything the run page needs, in one request. */
  async findOne(id: string) {
    const run = await this.prisma.run.findUnique({
      where: { id },
      include: {
        project: { select: { id: true, name: true, baseUrl: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        // Every page in the run, with its own status and why it failed.
        // Deliberately without pageSnapshot: twelve snapshots is megabytes on
        // a payload the UI polls every couple of seconds. The snapshot is
        // fetched per page by GET /api/runs/:id/pages/:pageId.
        pages: {
          orderBy: { order: 'asc' },
          select: {
            id: true,
            url: true,
            path: true,
            title: true,
            isEntry: true,
            discoveredFrom: true,
            depth: true,
            order: true,
            status: true,
            statusMessage: true,
            elementCount: true,
            scannedAt: true,
            plannedAt: true,
            _count: { select: { testCases: true, contentIssues: true, designIssues: true } },
          },
        },
        testCases: {
          orderBy: { order: 'asc' },
          include: {
            results: {
              // Chronological, NOT by attempt: a run can be executed more than
              // once, so "attempt 2" exists several times. Ordering by time is
              // what makes "the latest result" unambiguous.
              orderBy: [{ startedAt: 'asc' }],
              select: {
                id: true,
                attempt: true,
                status: true,
                durationMs: true,
                errorType: true,
                errorMessage: true,
                expected: true,
                actual: true,
                failedStepLabel: true,
                finalUrl: true,
                screenshotPath: true,
                tracePath: true,
                startedAt: true,
              },
            },
          },
        },
        rejections: { orderBy: { createdAt: 'asc' } },
        // Advisory wording problems. Ordered so the confident ones lead, since
        // this list is skimmed rather than read.
        contentIssues: { orderBy: [{ confidence: 'desc' }, { createdAt: 'asc' }] },
        // Closest misses first - a 1px difference is the surest sign of a real
        // mistake, so it should be the first thing a reviewer reads.
        designIssues: { orderBy: [{ offBy: 'asc' }, { createdAt: 'asc' }] },
        findings: {
          orderBy: { createdAt: 'desc' },
          include: {
            testCase: { select: { id: true, title: true, priority: true, requirement: true } },
            events: { orderBy: { createdAt: 'asc' } },
          },
        },
      },
    });

    if (!run) throw new NotFoundException(`Run ${id} not found`);

    // The encrypted credentials must never leave the backend - only the fact
    // that some exist.
    const hasCredentials = await this.prisma.runSecret
      .findUnique({ where: { runId: id } })
      .then((s) => Boolean(s?.emailCipher || s?.passwordCipher));

    // No hydration step any more: MongoDB stores steps, assertions and the page
    // snapshot as real documents, so what the driver returns is already the
    // response shape.
    return {
      ...run,
      hasCredentials,
      summary: summarise(run),
    };
  }

  /** Starts execution of everything currently approved. */
  async execute(id: string) {
    const run = await this.prisma.run.findUnique({ where: { id } });
    if (!run) throw new NotFoundException(`Run ${id} not found`);

    if (run.status === RunStatus.RUNNING) {
      throw new BadRequestException('This run is already executing.');
    }

    const approved = await this.prisma.testCase.count({
      where: { runId: id, approved: true, rejected: false },
    });
    if (!approved) {
      throw new BadRequestException(
        'Approve at least one test case before running. Review the proposed cases first.',
      );
    }

    // Flip to RUNNING synchronously, BEFORE returning. The client reloads the
    // run the moment this responds; if the status were still COMPLETED
    // it would conclude nothing is happening and stop polling, and the page
    // would look frozen for the whole run.
    await this.prisma.run.update({
      where: { id },
      data: {
        status: RunStatus.RUNNING,
        execStartedAt: new Date(),
        finishedAt: null,
        statusMessage: `Starting ${approved} test(s)`,
      },
    });

    this.pipeline.startExecution(id);
    return { started: true, approvedCount: approved };
  }

  /**
   * Re-plan: scan every page of the run again and ask the model again.
   *
   * The set of PAGES is deliberately kept. Re-crawling would spend another
   * minute of browser time rediscovering the same URLs, and worse, a nav bar
   * that changed in the meantime would quietly change what the run covers - so
   * "re-plan" would stop meaning "plan the same thing again". Use a new run to
   * pick up new pages.
   *
   * Written as sequential awaits rather than prisma.$transaction([...]).
   * MongoDB only supports multi-document transactions on a replica set, and
   * requiring one to re-plan would mean a single mongod could not run this
   * platform at all. Each step here is independently safe: worst case a crash
   * between them leaves a run with its rejections cleared, which the re-plan
   * about to run would have rewritten anyway.
   */
  async replan(id: string) {
    const run = await this.prisma.run.findUnique({ where: { id } });
    if (!run) throw new NotFoundException(`Run ${id} not found`);

    // Human-authored cases are kept - only the AI's proposals are regenerated.
    await this.prisma.testCase.deleteMany({ where: { runId: id, source: 'LLM' } });
    await this.prisma.policyRejection.deleteMany({ where: { runId: id } });
    // Advisory rows are regenerated too, so a re-plan does not leave two copies
    // of every typo. Dismissals live on the row, so this does lose them - which
    // is why it happens only on an explicit re-plan.
    //
    // A row a human already PROMOTED into a bug is kept: deleting it would take
    // the finding's evidence with it and leave a BUG-00n pointing at nothing.
    // Selected by id rather than with a `finding: null` relation filter, because
    // the foreign key lives on Finding - so the ids are what we actually have.
    const promoted = await this.prisma.finding.findMany({
      where: { runId: id },
      select: { contentIssueId: true, designIssueId: true },
    });
    await this.prisma.contentIssue.deleteMany({
      where: {
        runId: id,
        id: { notIn: promoted.map((f) => f.contentIssueId).filter(isId) },
      },
    });
    await this.prisma.designIssue.deleteMany({
      where: {
        runId: id,
        id: { notIn: promoted.map((f) => f.designIssueId).filter(isId) },
      },
    });
    await this.prisma.run.update({
      where: { id },
      data: { status: RunStatus.CREATED, statusMessage: 'Re-planning', finishedAt: null },
    });

    this.pipeline.startPlanning(id);
    return { started: true };
  }

  /**
   * One page's snapshot — what the AI was shown for THAT page.
   *
   * Split out of findOne because a twelve-page run's snapshots total several
   * megabytes, and findOne is polled every couple of seconds while a run is in
   * progress. The panel that shows it is opened on demand, so it can fetch on
   * demand too.
   */
  async findPage(runId: string, pageId: string) {
    const page = await this.prisma.runPage.findFirst({
      where: { id: pageId, runId },
      include: {
        contentIssues: { orderBy: [{ confidence: 'desc' }, { createdAt: 'asc' }] },
        designIssues: { orderBy: [{ offBy: 'asc' }, { createdAt: 'asc' }] },
        testCases: { orderBy: { order: 'asc' }, select: { id: true, title: true, priority: true } },
      },
    });
    if (!page) throw new NotFoundException(`Page ${pageId} not found on run ${runId}`);
    return page;
  }
}

function defaultRunName(url: string, wholeApp: boolean): string {
  try {
    const u = new URL(url);
    // A whole-app run is named after the app, not the entry page - calling a
    // twelve-page run "example.com - login" would be actively misleading.
    if (wholeApp) return `${u.hostname} - whole app`;
    const p = u.pathname === '/' ? 'home' : u.pathname.replace(/^\//, '').replace(/\/$/, '');
    return `${u.hostname} - ${p}`;
  } catch {
    return 'New run';
  }
}

/** Keeps a user-supplied number inside what the server is willing to do. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Trims, drops empties, and caps the list so a filter cannot become a payload. */
function cleanPaths(input?: string[]): string[] {
  return (input ?? [])
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 20);
}

/** Counts the frontend needs for the header, computed once here. */
function summarise(run: {
  pages?: Array<{ status: string }>;
  testCases: Array<{
    approved: boolean;
    rejected: boolean;
    results: Array<{ status: string; attempt: number }>;
  }>;
  findings: Array<{ status: string }>;
}) {
  // The newest result is the one that counts: a FAIL followed by a FLAKY pass
  // must report FLAKY, and a re-executed run must report its latest outcome
  // rather than a stale one from a previous execution.
  const latestByCase = run.testCases.map((tc) =>
    tc.results.length ? tc.results[tc.results.length - 1].status : null,
  );

  const pages = run.pages ?? [];

  return {
    // Page totals lead, because on a whole-app run "3 of 12 pages could not be
    // read" is the single most important thing on the screen - a run that looks
    // green while a quarter of the app was unreachable is a lie.
    totalPages: pages.length,
    pagesPlanned: pages.filter((p) => p.status === 'PLANNED').length,
    pagesFailed: pages.filter((p) => p.status === 'SCAN_FAILED' || p.status === 'PLAN_FAILED')
      .length,
    pagesSkipped: pages.filter((p) => p.status === 'SKIPPED').length,

    totalCases: run.testCases.length,
    approvedCases: run.testCases.filter((c) => c.approved && !c.rejected).length,
    rejectedCases: run.testCases.filter((c) => c.rejected).length,
    executed: latestByCase.filter(Boolean).length,
    passed: latestByCase.filter((s) => s === 'PASS').length,
    failed: latestByCase.filter((s) => s === 'FAIL').length,
    errored: latestByCase.filter((s) => s === 'ERROR').length,
    flaky: latestByCase.filter((s) => s === 'FLAKY').length,
    openFindings: run.findings.filter((f) => OPEN_FINDING_STATUSES.includes(f.status as never))
      .length,
    confirmedFindings: run.findings.filter((f) => f.status === 'CONFIRMED').length,
  };
}

/**
 * People paste the whole Figma URL, not the file key, so accept either.
 * figma.com/design/ABC123/My-File?node-id=1-2  ->  ABC123
 */
function parseFigmaFileKey(input?: string): string | null {
  const raw = input?.trim();
  if (!raw) return null;
  const m = raw.match(/figma\.com\/(?:file|design)\/([0-9a-zA-Z]{10,128})/);
  return m ? m[1] : raw;
}

/** Figma writes node ids as "1-2" in URLs and "1:2" in the API. */
function normaliseNodeId(input?: string): string | null {
  const raw = input?.trim();
  if (!raw) return null;
  const fromUrl = raw.match(/node-id=([0-9]+[-:][0-9]+)/);
  return (fromUrl ? fromUrl[1] : raw).replace('-', ':');
}

/** Narrows a nullable id list to the ids that are actually set. */
function isId(v: string | null): v is string {
  return typeof v === 'string' && v.length > 0;
}
