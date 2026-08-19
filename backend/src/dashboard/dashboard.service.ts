import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * DASHBOARD AGGREGATES.
 *
 * One endpoint, one round trip, because a dashboard that fires eight requests
 * renders in eight stages and looks broken while it does.
 *
 * The numbers are chosen to answer four questions a QA lead actually asks:
 *   1. Is the suite healthy?        -> pass rate, flaky count
 *   2. What needs me today?         -> findings awaiting triage, tickets to retest
 *   3. What did we find?            -> confirmed bugs by severity
 *   4. Is the tooling itself okay?  -> test defects vs product bugs
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Scoped like every other list: by default you see only your own work.
   * A dashboard that mixes in a colleague's runs makes the pass rate lie.
   */
  async overview(scope: 'mine' | 'team', userId: string) {
    const mine = scope === 'mine';
    const runWhere = mine ? { createdById: userId } : {};
    const viaRun = mine ? { run: { createdById: userId } } : {};
    const ticketWhere = mine
      ? {
          OR: [
            { finding: { run: { createdById: userId } } },
            { assigneeId: userId },
            { reporterId: userId },
          ],
        }
      : {};

    const [
      runCount,
      runsByStatus,
      testCases,
      findingsByStatus,
      ticketsByStatus,
      confirmedFindings,
      recentRuns,
      needsTriage,
      needsRetest,
      llmUsage,
    ] = await Promise.all([
      this.prisma.run.count({ where: runWhere }),
      this.prisma.run.groupBy({ by: ['status'], where: runWhere, _count: true }),

      // Latest result per test case. Pulled lean and reduced in JS: SQLite has no
      // window functions through Prisma, and MVP volumes make this trivial.
      this.prisma.testCase.findMany({
        where: viaRun,
        select: {
          id: true,
          approved: true,
          rejected: true,
          source: true,
          results: {
            orderBy: { startedAt: 'desc' },
            take: 1,
            select: { status: true, durationMs: true },
          },
        },
      }),

      this.prisma.finding.groupBy({ by: ['status'], where: viaRun, _count: true }),
      this.prisma.ticket.groupBy({ by: ['status'], where: ticketWhere, _count: true }),

      this.prisma.finding.findMany({
        where: { status: { in: ['CONFIRMED', 'REOPENED'] }, ...viaRun },
        select: { severity: true, humanClassification: true, aiClassification: true },
      }),

      this.prisma.run.findMany({
        where: runWhere,
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: {
          id: true,
          name: true,
          targetUrl: true,
          status: true,
          statusMessage: true,
          createdAt: true,
          _count: { select: { testCases: true, findings: true } },
        },
      }),

      this.prisma.finding.findMany({
        where: { status: { in: ['NEW', 'REOPENED'] }, ...viaRun },
        orderBy: { lastSeenAt: 'desc' },
        take: 5,
        select: {
          id: true,
          bugKey: true,
          status: true,
          aiClassification: true,
          aiConfidence: true,
          occurrences: true,
          runId: true,
          testCase: { select: { title: true, priority: true } },
        },
      }),

      this.prisma.ticket.findMany({
        where: { status: { in: ['OPEN', 'READY_FOR_RETEST', 'REOPENED'] }, ...ticketWhere },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: {
          id: true,
          key: true,
          title: true,
          status: true,
          priority: true,
          assignee: { select: { name: true } },
        },
      }),

      this.prisma.run.aggregate({
        where: runWhere,
        _sum: { llmTokensIn: true, llmTokensOut: true },
      }),
    ]);

    // ---------------------------------------------------------- test health
    const latest = testCases.map((tc) => tc.results[0]?.status ?? null);
    const executed = latest.filter(Boolean).length;
    const passed = latest.filter((s) => s === 'PASS').length;
    const failed = latest.filter((s) => s === 'FAIL').length;
    const errored = latest.filter((s) => s === 'ERROR').length;
    const flaky = latest.filter((s) => s === 'FLAKY').length;

    // Rounded to a whole number: false precision on a small sample is noise.
    const passRate = executed ? Math.round((passed / executed) * 100) : null;

    // ------------------------------------------------ how good is the AI?
    // Test defects mean the generated test was wrong, product bugs mean the app
    // was wrong. The ratio is the honest measure of whether the tool is helping.
    const classifications = confirmedFindings.map(
      (f) => f.humanClassification ?? f.aiClassification ?? 'UNKNOWN',
    );

    return {
      runs: {
        total: runCount,
        byStatus: toCounts(runsByStatus),
      },
      tests: {
        total: testCases.length,
        approved: testCases.filter((t) => t.approved && !t.rejected).length,
        humanEdited: testCases.filter((t) => t.source === 'MANUAL').length,
        executed,
        passed,
        failed,
        errored,
        flaky,
        passRate,
      },
      findings: {
        byStatus: toCounts(findingsByStatus),
        awaitingTriage:
          countOf(findingsByStatus, 'NEW') + countOf(findingsByStatus, 'REOPENED'),
        confirmed: confirmedFindings.length,
        bySeverity: tally(confirmedFindings.map((f) => f.severity ?? 'UNSET')),
        byClassification: tally(classifications),
      },
      tickets: {
        byStatus: toCounts(ticketsByStatus),
        open:
          countOf(ticketsByStatus, 'OPEN') +
          countOf(ticketsByStatus, 'IN_PROGRESS') +
          countOf(ticketsByStatus, 'REOPENED'),
        readyForRetest: countOf(ticketsByStatus, 'READY_FOR_RETEST'),
      },
      llm: {
        tokensIn: llmUsage._sum.llmTokensIn ?? 0,
        tokensOut: llmUsage._sum.llmTokensOut ?? 0,
      },
      recentRuns,
      needsTriage,
      needsRetest,
    };
  }
}

type Grouped = Array<{ status: string; _count: number }>;

function toCounts(rows: Grouped): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = r._count;
  return out;
}

function countOf(rows: Grouped, status: string): number {
  return rows.find((r) => r.status === status)?._count ?? 0;
}

function tally(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}
