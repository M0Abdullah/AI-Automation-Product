import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Finding } from '@prisma/client';
import { CounterName, FindingStatus } from '../common/enums';
import { CounterService } from '../common/counter.service';
import { hydrateFinding, hydrateResult } from '../common/hydrate';
import { PrismaService } from '../prisma/prisma.service';
import { FindingNoteDto, TriageFindingDto } from './dto/triage.dto';

/**
 * THE QA WORKFLOW.
 *
 * A failure arrives as a Finding with status NEW. From there a human drives it:
 *
 *   NEW ──triage(CONFIRM)──> CONFIRMED ──close──> CLOSED ──reopen──> REOPENED
 *    │                                                                  │
 *    └──triage(REJECT)────> REJECTED ──reopen──> REOPENED ──────────────┘
 *
 * Every move is recorded in FindingEvent with actor, timestamp and note, so the
 * history of a bug is never lost. Reopening is a first-class action, because in
 * real QA work "it came back" is the normal case, not an edge case.
 */
@Injectable()
export class FindingsService {
  /** Which moves are legal from each status. Enforced, not assumed. */
  private static readonly TRANSITIONS: Record<string, FindingStatus[]> = {
    NEW: [FindingStatus.TRIAGED, FindingStatus.CONFIRMED, FindingStatus.REJECTED],
    TRIAGED: [FindingStatus.CONFIRMED, FindingStatus.REJECTED],
    CONFIRMED: [FindingStatus.CLOSED, FindingStatus.REJECTED],
    REJECTED: [FindingStatus.REOPENED, FindingStatus.CONFIRMED],
    REOPENED: [FindingStatus.CONFIRMED, FindingStatus.REJECTED, FindingStatus.CLOSED],
    CLOSED: [FindingStatus.REOPENED],
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly counters: CounterService,
  ) {}

  async findAll(filter: {
    status?: string;
    runId?: string;
    scope?: 'mine' | 'team';
    userId?: string;
  }) {
    const rows = await this.prisma.finding.findMany({
      where: {
        status: filter.status,
        runId: filter.runId,
        // Findings inherit the visibility of the run that produced them.
        ...(filter.scope === 'mine' && filter.userId
          ? { run: { createdById: filter.userId } }
          : {}),
      },
      orderBy: [{ status: 'asc' }, { lastSeenAt: 'desc' }],
      take: 200,
      include: {
        testCase: { select: { id: true, title: true, priority: true, requirement: true } },
        run: { select: { id: true, name: true, targetUrl: true } },
        // The card renders the audit trail inline, so it ships with the list.
        events: { orderBy: { createdAt: 'asc' } },
        ticket: {
          select: { id: true, key: true, status: true, externalKey: true, externalUrl: true },
        },
        result: {
          select: {
            id: true,
            status: true,
            errorType: true,
            errorMessage: true,
            expected: true,
            actual: true,
            screenshotPath: true,
            tracePath: true,
            finalUrl: true,
            browserName: true,
            viewport: true,
            attempt: true,
            startedAt: true,
          },
        },
      },
    });

    return rows.map((r) => hydrateFinding(r as unknown as Record<string, unknown>));
  }

  /** Full detail for the bug-report view, including all evidence. */
  async findOne(id: string) {
    const finding = await this.prisma.finding.findUnique({
      where: { id },
      include: {
        testCase: true,
        run: { select: { id: true, name: true, targetUrl: true, requirements: true } },
        result: { include: { consoleLogs: true, networkLogs: true } },
        events: { orderBy: { createdAt: 'asc' } },
        ticket: {
          include: {
            assignee: { select: { id: true, name: true, email: true } },
            reporter: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });
    if (!finding) throw new NotFoundException(`Finding ${id} not found`);
    return hydrateFinding(finding as unknown as Record<string, unknown>);
  }

  /**
   * The decision point. CONFIRM makes it a defect; REJECT records why it was
   * not one (wrong locator, environment, stale data) so the same mistake can be
   * measured and fixed.
   */
  async triage(id: string, dto: TriageFindingDto) {
    const finding = await this.get(id);
    const target =
      dto.decision === 'CONFIRM' ? FindingStatus.CONFIRMED : FindingStatus.REJECTED;
    this.assertTransition(finding, target);

    // A confirmed defect earns a permanent, quotable id: BUG-007.
    // Allocated once - a finding that is rejected, reopened and confirmed again
    // keeps the same number, because it is the same bug.
    let bugFields = {};
    if (target === FindingStatus.CONFIRMED && !finding.bugKey) {
      const { key, number } = await this.counters.nextKey(CounterName.BUG, 'BUG');
      bugFields = { bugKey: key, bugNumber: number };
    }

    const updated = await this.prisma.finding.update({
      where: { id },
      data: {
        ...bugFields,
        module: dto.module ?? finding.module,
        build: dto.build ?? finding.build,
        priority: dto.priority ?? finding.priority,
        status: target,
        humanClassification: dto.classification,
        // Severity only makes sense on a confirmed defect.
        severity: dto.decision === 'CONFIRM' ? (dto.severity ?? null) : null,
        assignee: dto.assignee ?? finding.assignee,
        triagedBy: dto.actor ?? 'qa@local',
        triagedAt: new Date(),
        note: dto.note ?? finding.note,
      },
    });

    await this.event(id, finding.status, target, dto.actor, dto.note ?? defaultNote(dto));
    return this.findOne(updated.id);
  }

  /** A bug that came back. The most important QA action after triage. */
  async reopen(id: string, dto: FindingNoteDto) {
    const finding = await this.get(id);
    this.assertTransition(finding, FindingStatus.REOPENED);

    await this.prisma.finding.update({
      where: { id },
      data: {
        status: FindingStatus.REOPENED,
        occurrences: { increment: 1 },
        lastSeenAt: new Date(),
      },
    });

    await this.event(
      id,
      finding.status,
      FindingStatus.REOPENED,
      dto.actor,
      dto.note ?? 'Reopened - the problem is back.',
    );
    return this.findOne(id);
  }

  async close(id: string, dto: FindingNoteDto) {
    const finding = await this.get(id);
    this.assertTransition(finding, FindingStatus.CLOSED);

    await this.prisma.finding.update({
      where: { id },
      data: { status: FindingStatus.CLOSED },
    });
    await this.event(
      id,
      finding.status,
      FindingStatus.CLOSED,
      dto.actor,
      dto.note ?? 'Closed by QA.',
    );
    return this.findOne(id);
  }

  /** A comment without a status change - still part of the audit trail. */
  async comment(id: string, dto: FindingNoteDto) {
    const finding = await this.get(id);
    if (!dto.note?.trim()) throw new BadRequestException('A comment needs text.');
    await this.event(
      id,
      finding.status,
      finding.status as FindingStatus,
      dto.actor,
      dto.note,
    );
    return this.findOne(id);
  }

  /** Counts for the inbox badges, scoped the same way as the list. */
  async stats(scope: 'mine' | 'team', userId: string) {
    const grouped = await this.prisma.finding.groupBy({
      by: ['status'],
      where: scope === 'mine' ? { run: { createdById: userId } } : {},
      _count: true,
    });
    const out: Record<string, number> = {
      NEW: 0,
      TRIAGED: 0,
      CONFIRMED: 0,
      REJECTED: 0,
      REOPENED: 0,
      CLOSED: 0,
    };
    for (const g of grouped) out[g.status] = g._count;
    return out;
  }

  // ------------------------------------------------------------- internals

  private async get(id: string): Promise<Finding> {
    const f = await this.prisma.finding.findUnique({ where: { id } });
    if (!f) throw new NotFoundException(`Finding ${id} not found`);
    return f;
  }

  private assertTransition(finding: Finding, to: FindingStatus) {
    const allowed = FindingsService.TRANSITIONS[finding.status] ?? [];
    if (!allowed.includes(to)) {
      throw new BadRequestException(
        `Cannot move a finding from ${finding.status} to ${to}. ` +
          `Allowed: ${allowed.join(', ') || 'none'}.`,
      );
    }
  }

  private event(
    findingId: string,
    from: string,
    to: FindingStatus,
    actor?: string,
    note?: string,
  ) {
    return this.prisma.findingEvent.create({
      data: { findingId, fromStatus: from, toStatus: to, actor: actor ?? 'qa@local', note },
    });
  }
}

function defaultNote(dto: TriageFindingDto): string {
  return dto.decision === 'CONFIRM'
    ? `Confirmed as ${dto.classification} by QA.`
    : `Rejected: classified as ${dto.classification}, not a product defect.`;
}
