import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CaseSource } from '../common/enums';
import { readJson, writeJson } from '../common/json';
import type { TestAssertion, TestCasePlan, TestStep } from '../common/test-plan.types';
import { PolicyService } from '../policy/policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { RunPipelineService } from '../runs/run-pipeline.service';
import { RejectTestCaseDto, UpdateTestCaseDto } from './dto/update-test-case.dto';

/**
 * PHASE D: HUMAN REVIEW.
 *
 * Nothing runs until a person approves it. This service is that gate, plus the
 * editor behind it. Human edits are re-validated by the same policy engine that
 * validated the model - the gate does not open just because a human typed it.
 */
@Injectable()
export class TestCasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly pipeline: RunPipelineService,
  ) {}

  async findOne(id: string) {
    const tc = await this.prisma.testCase.findUnique({
      where: { id },
      include: {
        run: { select: { id: true, targetUrl: true, allowDestructive: true } },
        results: {
          orderBy: { startedAt: 'asc' },
          // findings, not finding: see schema.prisma. Collapsed below so the
          // response shape does not change.
          include: { consoleLogs: true, networkLogs: true, findings: { take: 1 } },
        },
      },
    });
    if (!tc) throw new NotFoundException(`Test case ${id} not found`);

    return {
      ...tc,
      results: tc.results.map(({ findings, ...r }) => ({ ...r, finding: findings[0] ?? null })),
    };
  }

  async update(id: string, dto: UpdateTestCaseDto) {
    const existing = await this.prisma.testCase.findUnique({
      where: { id },
      include: { run: { select: { targetUrl: true, allowDestructive: true } } },
    });
    if (!existing) throw new NotFoundException(`Test case ${id} not found`);

    const steps = (dto.steps ?? readJson<TestStep[]>(existing.steps, [])) as TestStep[];
    const assertions = (dto.assertions ??
      readJson<TestAssertion[]>(existing.assertions, [])) as TestAssertion[];

    // Re-run the policy check on the edited version.
    const candidate: TestCasePlan = {
      title: dto.title ?? existing.title,
      priority: (dto.priority ?? existing.priority) as TestCasePlan['priority'],
      steps,
      assertions,
      destructive: existing.destructive,
    };

    // Validated against the case's OWN page, not the run's entry URL. Same
    // origin either way, so the navigation rule is unchanged - but on a
    // whole-app run the entry URL is not where this case runs, and passing it
    // would make the error messages point at the wrong page.
    const { accepted, rejections } = this.policy.review(
      [candidate],
      existing.pageUrl ?? existing.run.targetUrl,
      existing.run.allowDestructive,
    );

    if (!accepted.length) {
      throw new BadRequestException({
        message: 'The edited test case violates the execution policy and was not saved.',
        details: rejections.map((r) => `${r.stage}: ${r.reason}`),
      });
    }

    const edited = Boolean(dto.steps || dto.assertions);

    const saved = await this.prisma.testCase.update({
      where: { id },
      data: {
        title: candidate.title,
        priority: candidate.priority,
        requirement: dto.requirement ?? existing.requirement,
        steps: writeJson(steps),
        assertions: writeJson(assertions),
        // Any structural edit marks the case as human-authored, which is what
        // makes "percentage of AI tests approved without edits" measurable.
        source: edited ? CaseSource.MANUAL : existing.source,
        approved: dto.approved ?? existing.approved,
        approvedAt: dto.approved ? new Date() : existing.approvedAt,
        rejected: dto.approved ? false : existing.rejected,
      },
    });

    return saved;
  }

  async approve(id: string) {
    const saved = await this.prisma.testCase.update({
      where: { id },
      data: { approved: true, approvedAt: new Date(), rejected: false, rejectionReason: null },
    });
    return saved;
  }

  async reject(id: string, dto: RejectTestCaseDto) {
    const saved = await this.prisma.testCase.update({
      where: { id },
      data: {
        approved: false,
        rejected: true,
        rejectionReason: dto.reason?.trim() || 'Rejected by QA during review',
      },
    });
    return saved;
  }

  /** Bulk approve - the common case when the plan looks right. */
  async approveAll(runId: string) {
    const res = await this.prisma.testCase.updateMany({
      where: { runId, rejected: false },
      data: { approved: true, approvedAt: new Date() },
    });
    return { approved: res.count };
  }

  /**
   * Re-run one test case on demand. This is the "Ready for Retest" action:
   * a developer says it is fixed, QA clicks retest, the same test runs again.
   */
  async retest(id: string) {
    const tc = await this.prisma.testCase.findUnique({
      where: { id },
      include: { run: { include: { secret: true } } },
    });
    if (!tc) throw new NotFoundException(`Test case ${id} not found`);

    // Deliberately awaited: a retest is a foreground action the user is
    // watching, and it is one test rather than a whole suite.
    await this.pipeline.runSingleCase(tc.run, tc);

    const latest = await this.prisma.testResult.findFirst({
      where: { testCaseId: id },
      orderBy: { startedAt: 'desc' },
      include: { consoleLogs: true, networkLogs: true },
    });

    return { retested: true, result: latest };
  }
}
