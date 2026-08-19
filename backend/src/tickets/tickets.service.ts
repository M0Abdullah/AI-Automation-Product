import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CounterName, TICKET_TRANSITIONS, TicketStatus, type TicketStatus as TicketStatusT } from '../common/enums';
import { CounterService } from '../common/counter.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import { RunPipelineService } from '../runs/run-pipeline.service';
import type { JwtPayload } from '../auth/auth.service';
import {
  CreateTicketDto,
  LinkExternalDto,
  TicketCommentDto,
  UpdateTicketDto,
} from './dto/ticket.dto';

/**
 * TICKETS — the developer-facing work item.
 *
 * A ticket is created FROM a confirmed finding and is prefilled with the
 * evidence the run already captured, so the reporter does not retype anything.
 *
 * The finding remains the QA record ("is this a real defect?"). The ticket is
 * the assignment and lifecycle ("who is fixing it, and is it fixed?"). Keeping
 * them separate is what allows a bug to be rejected without deleting history,
 * and a ticket to be reopened without re-triaging.
 */
@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly counters: CounterService,
    private readonly reports: ReportsService,
    private readonly pipeline: RunPipelineService,
  ) {}

  /**
   * Creates the ticket, and assigns the finding its permanent BUG key if it does
   * not have one yet. Both keys are allocated atomically via the counter table.
   */
  async createFromFinding(findingId: string, dto: CreateTicketDto, actor: JwtPayload) {
    const finding = await this.prisma.finding.findUnique({
      where: { id: findingId },
      include: {
        testCase: true,
        run: { select: { name: true, targetUrl: true } },
        result: { select: { errorType: true, errorMessage: true, expected: true, actual: true } },
        ticket: { select: { id: true, key: true } },
      },
    });
    if (!finding) throw new NotFoundException(`Finding ${findingId} not found`);

    if (finding.ticket) {
      throw new BadRequestException(
        `This finding already has ${finding.ticket.key}. Open that ticket instead of creating a second one.`,
      );
    }

    // A ticket means "somebody should fix this", which only makes sense once a
    // human has agreed it is a defect.
    if (!['CONFIRMED', 'REOPENED'].includes(finding.status)) {
      throw new BadRequestException(
        `Confirm the finding as a defect before creating a ticket. It is currently ${finding.status}.`,
      );
    }

    // Assign the permanent bug id on first ticket creation.
    let bugKey = finding.bugKey;
    if (!bugKey) {
      const { key, number } = await this.counters.nextKey(CounterName.BUG, 'BUG');
      bugKey = key;
      await this.prisma.finding.update({
        where: { id: findingId },
        data: {
          bugKey: key,
          bugNumber: number,
          module: dto.module ?? finding.module,
          build: dto.build ?? finding.build,
          priority: dto.priority ?? finding.priority ?? finding.testCase.priority,
        },
      });
    }

    const { key: ticketKey, number } = await this.counters.nextKey(CounterName.TICKET, 'TICKET');

    // The description defaults to the full generated bug report, so the ticket
    // is self-contained: a developer never has to come back to this tool to
    // understand the problem.
    const generated = await this.reports.markdown(findingId);
    const description: string = dto.description?.trim() || generated.body;

    const ticket = await this.prisma.ticket.create({
      data: {
        key: ticketKey,
        number,
        findingId,
        title: dto.title ?? `${bugKey}: ${finding.testCase.title}`,
        description,
        status: TicketStatus.OPEN,
        priority: dto.priority ?? finding.priority ?? finding.testCase.priority ?? 'P2',
        severity: dto.severity ?? finding.severity,
        module: dto.module ?? finding.module,
        build: dto.build ?? finding.build,
        labels: dto.labels ?? '',
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        assigneeId: dto.assigneeId ?? null,
        reporterId: actor.sub,
      },
      include: TICKET_INCLUDE,
    });

    await this.event(ticket.id, 'created', null, ticketKey, actor, `Created from ${bugKey}.`);
    if (dto.assigneeId) {
      await this.event(
        ticket.id,
        'assignee',
        null,
        await this.describeUser(dto.assigneeId),
        actor,
        'Assigned on creation.',
      );
    }

    this.logger.log(`${ticketKey} created from ${bugKey} by ${actor.email}`);
    return ticket;
  }

  findAll(filter: {
    status?: string;
    assigneeId?: string;
    scope?: 'mine' | 'team';
    userId?: string;
  }) {
    return this.prisma.ticket.findMany({
      where: {
        status: filter.status,
        assigneeId: filter.assigneeId,
        // "Mine" means: raised from my run, assigned to me, or reported by me.
        // A ticket assigned to you must stay visible even if someone else
        // started the run that found it.
        ...(filter.scope === 'mine' && filter.userId
          ? {
              OR: [
                { finding: { run: { createdById: filter.userId } } },
                { assigneeId: filter.userId },
                { reporterId: filter.userId },
              ],
            }
          : {}),
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 200,
      include: TICKET_INCLUDE,
    });
  }

  async findOne(id: string) {
    const ticket = await this.prisma.ticket.findFirst({
      // Accept either the uuid or the human key, because people paste "TICKET-7".
      where: { OR: [{ id }, { key: id.toUpperCase() }] },
      include: {
        ...TICKET_INCLUDE,
        comments: {
          orderBy: { createdAt: 'asc' },
          include: { author: { select: { id: true, name: true, email: true } } },
        },
        events: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!ticket) throw new NotFoundException(`Ticket ${id} not found`);
    return ticket;
  }

  /** Field updates and status moves, each recorded in the audit trail. */
  async update(id: string, dto: UpdateTicketDto, actor: JwtPayload) {
    const existing = await this.prisma.ticket.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Ticket ${id} not found`);

    if (dto.status && dto.status !== existing.status) {
      const allowed = TICKET_TRANSITIONS[existing.status as TicketStatusT] ?? [];
      if (!allowed.includes(dto.status as TicketStatusT)) {
        throw new BadRequestException(
          `Cannot move ${existing.key} from ${existing.status} to ${dto.status}. ` +
            `Allowed: ${allowed.join(', ') || 'none'}.`,
        );
      }
    }

    const ticket = await this.prisma.ticket.update({
      where: { id },
      data: {
        title: dto.title ?? undefined,
        description: dto.description ?? undefined,
        status: dto.status ?? undefined,
        priority: dto.priority ?? undefined,
        severity: dto.severity ?? undefined,
        module: dto.module ?? undefined,
        build: dto.build ?? undefined,
        labels: dto.labels ?? undefined,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        assigneeId: dto.assigneeId ?? undefined,
        resolvedAt: dto.status === TicketStatus.RESOLVED ? new Date() : undefined,
        closedAt: dto.status === TicketStatus.CLOSED ? new Date() : undefined,
      },
      include: TICKET_INCLUDE,
    });

    // One event per changed field, so the history reads as a story rather than
    // a diff. User ids are resolved to names first - "changed assignee to
    // 8a98b4e2-6382..." is unreadable in an audit trail.
    for (const field of [
      'status',
      'priority',
      'severity',
      'assigneeId',
      'module',
      'build',
    ] as const) {
      const before = (existing as Record<string, unknown>)[field];
      const after = (dto as Record<string, unknown>)[field];
      if (after === undefined || after === before) continue;

      if (field === 'assigneeId') {
        await this.event(
          id,
          'assignee',
          await this.describeUser(before as string | null),
          await this.describeUser(after as string | null),
          actor,
        );
      } else {
        await this.event(id, field, String(before ?? ''), String(after), actor);
      }
    }

    return ticket;
  }

  async comment(id: string, dto: TicketCommentDto, actor: JwtPayload) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundException(`Ticket ${id} not found`);

    await this.prisma.ticketComment.create({
      data: { ticketId: id, authorId: actor.sub, body: dto.body.trim() },
    });
    await this.event(id, 'comment', null, null, actor, dto.body.slice(0, 200));
    return this.findOne(id);
  }

  /**
   * The Ready-for-Retest handoff: rerun the linked test right now.
   *
   * A passing rerun SUGGESTS the fix worked - it does not close the ticket.
   * Automatic closure on a green test is exactly how a real regression slips
   * through, so the decision stays with a person.
   */
  async retest(id: string, actor: JwtPayload) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
        finding: {
          include: {
            testCase: true,
            run: { include: { secret: true } },
          },
        },
      },
    });
    if (!ticket) throw new NotFoundException(`Ticket ${id} not found`);

    await this.pipeline.runSingleCase(ticket.finding.run, ticket.finding.testCase);

    const latest = await this.prisma.testResult.findFirst({
      where: { testCaseId: ticket.finding.testCaseId },
      orderBy: { startedAt: 'desc' },
      select: { id: true, status: true, errorType: true, errorMessage: true },
    });

    const passed = latest?.status === 'PASS';
    await this.event(
      id,
      'retest',
      null,
      latest?.status ?? 'UNKNOWN',
      actor,
      passed
        ? 'Retest PASSED. Looks fixed - a human still has to resolve the ticket.'
        : `Retest ${latest?.status}: ${latest?.errorMessage?.slice(0, 200) ?? 'still failing'}`,
    );

    return { retested: true, passed, result: latest, suggestion: passed ? 'RESOLVE' : 'KEEP_OPEN' };
  }

  /**
   * Records the Jira/Linear/GitHub issue this ticket maps to, so the UI can show
   * a link that opens the external tracker.
   *
   * Deliberately manual for now: paste the key and URL. A live API connector
   * needs credentials per organisation, and this covers the workflow today
   * without asking anyone for an API token.
   */
  async linkExternal(id: string, dto: LinkExternalDto, actor: JwtPayload) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundException(`Ticket ${id} not found`);

    let url: URL;
    try {
      url = new URL(dto.externalUrl);
    } catch {
      throw new BadRequestException('externalUrl must be a full URL including https://');
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new BadRequestException('externalUrl must be http or https');
    }

    const updated = await this.prisma.ticket.update({
      where: { id },
      data: {
        externalKey: dto.externalKey.trim().toUpperCase(),
        externalUrl: url.toString(),
        externalProvider: dto.provider ?? inferProvider(url.hostname),
        externalSyncedAt: new Date(),
      },
      include: TICKET_INCLUDE,
    });

    await this.event(id, 'external', ticket.externalKey, updated.externalKey, actor, 'Linked to tracker.');
    return updated;
  }

  /** Board counts, scoped the same way as the list. */
  async stats(scope: 'mine' | 'team', userId: string) {
    const grouped = await this.prisma.ticket.groupBy({
      by: ['status'],
      where:
        scope === 'mine'
          ? {
              OR: [
                { finding: { run: { createdById: userId } } },
                { assigneeId: userId },
                { reporterId: userId },
              ],
            }
          : {},
      _count: true,
    });
    const out: Record<string, number> = {
      OPEN: 0,
      IN_PROGRESS: 0,
      READY_FOR_RETEST: 0,
      RESOLVED: 0,
      REOPENED: 0,
      CLOSED: 0,
    };
    for (const g of grouped) out[g.status] = g._count;
    return out;
  }

  /** Turns a user id into a readable name for the audit trail. */
  private async describeUser(userId: string | null | undefined): Promise<string> {
    if (!userId) return 'Unassigned';
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    });
    return user?.name ?? user?.email ?? 'Unknown user';
  }

  private event(
    ticketId: string,
    field: string,
    fromValue: string | null,
    toValue: string | null,
    actor: JwtPayload,
    note?: string,
  ) {
    return this.prisma.ticketEvent.create({
      data: { ticketId, field, fromValue, toValue, actor: actor.email, note },
    });
  }
}

const TICKET_INCLUDE = {
  assignee: { select: { id: true, name: true, email: true } },
  reporter: { select: { id: true, name: true, email: true } },
  finding: {
    select: {
      id: true,
      bugKey: true,
      status: true,
      severity: true,
      aiClassification: true,
      humanClassification: true,
      occurrences: true,
      runId: true,
      testCaseId: true,
      // The ticket page shows the failure screenshot, so the paths travel with
      // the ticket rather than needing a second request.
      result: {
        select: {
          id: true,
          screenshotPath: true,
          tracePath: true,
          browserName: true,
          viewport: true,
          attempt: true,
        },
      },
    },
  },
} as const;

function inferProvider(hostname: string): string {
  const h = hostname.toLowerCase();
  if (h.includes('atlassian')) return 'jira';
  if (h.includes('linear')) return 'linear';
  if (h.includes('github')) return 'github';
  if (h.includes('azure') || h.includes('visualstudio')) return 'azure';
  return 'other';
}
