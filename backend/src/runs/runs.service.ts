import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { resolveChecks } from '../common/check-catalog';
import { packTags, unpackTags } from '../common/db-json';
import { OPEN_FINDING_STATUSES, RunStatus } from '../common/enums';
import { hydrateRun } from '../common/hydrate';
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

    const project = await this.projects.findOrCreateForUrl(dto.url, dto.name);

    const run = await this.prisma.run.create({
      data: {
        projectId: project.id,
        name: dto.name?.trim() || defaultRunName(dto.url),
        targetUrl: dto.url,
        requirements: requirements,
        checks: packTags(checks.map((c) => c.id)),
        authorized: dto.authorized,
        allowDestructive: Boolean(dto.allowDestructive),
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
        _count: { select: { testCases: true, findings: true } },
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

    // hydrateRun turns the SQLite JSON-text columns back into real objects, so
    // the response shape is identical to what PostgreSQL jsonb would give.
    return {
      ...hydrateRun(run as unknown as Record<string, unknown>),
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
    // run the moment this responds; if the status were still AWAITING_APPROVAL
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

  /** Re-plan from scratch: scan again and ask the model again. */
  async replan(id: string) {
    const run = await this.prisma.run.findUnique({ where: { id } });
    if (!run) throw new NotFoundException(`Run ${id} not found`);

    // Human-authored cases are kept - only the AI's proposals are regenerated.
    await this.prisma.$transaction([
      this.prisma.testCase.deleteMany({ where: { runId: id, source: 'LLM' } }),
      this.prisma.policyRejection.deleteMany({ where: { runId: id } }),
      this.prisma.run.update({
        where: { id },
        data: { status: RunStatus.CREATED, statusMessage: 'Re-planning', finishedAt: null },
      }),
    ]);

    this.pipeline.startPlanning(id);
    return { started: true };
  }
}

function defaultRunName(url: string): string {
  try {
    const u = new URL(url);
    const p = u.pathname === '/' ? 'home' : u.pathname.replace(/^\//, '').replace(/\/$/, '');
    return `${u.hostname} - ${p}`;
  } catch {
    return 'New run';
  }
}

/** Counts the frontend needs for the header, computed once here. */
function summarise(run: {
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

  return {
    totalCases: run.testCases.length,
    approvedCases: run.testCases.filter((c) => c.approved && !c.rejected).length,
    rejectedCases: run.testCases.filter((c) => c.rejected).length,
    executed: latestByCase.filter(Boolean).length,
    passed: latestByCase.filter((s) => s === 'PASS').length,
    failed: latestByCase.filter((s) => s === 'FAIL').length,
    errored: latestByCase.filter((s) => s === 'ERROR').length,
    flaky: latestByCase.filter((s) => s === 'FLAKY').length,
    openFindings: run.findings.filter((f) =>
      OPEN_FINDING_STATUSES.includes(f.status as never),
    ).length,
    confirmedFindings: run.findings.filter((f) => f.status === 'CONFIRMED').length,
  };
}
