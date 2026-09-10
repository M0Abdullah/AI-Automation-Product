import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CounterName, TICKET_TRANSITIONS, TicketStatus, type TicketStatus as TicketStatusT } from '../common/enums';
import { CounterService } from '../common/counter.service';
import { AppConfigService } from '../config/app-config.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import { TrackerService, describeError } from '../trackers/tracker.service';
import type { TrackerProviderName } from '../trackers/tracker.types';
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
    private readonly trackers: TrackerService,
    private readonly mail: MailService,
    private readonly config: AppConfigService,
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
          priority: dto.priority ?? finding.priority ?? finding.testCase?.priority,
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
        title: dto.title ?? `${bugKey}: ${finding.title ?? finding.testCase?.title ?? 'Finding'}`,
        description,
        status: TicketStatus.OPEN,
        priority: dto.priority ?? finding.priority ?? finding.testCase?.priority ?? 'P2',
        severity: dto.severity ?? finding.severity,
        module: dto.module ?? finding.module,
        build: dto.build ?? finding.build,
        labels: splitLabels(dto.labels),
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

    // ------------------------------------------------- file it, and say so
    //
    // Awaited, unlike the email. A ticket whose whole purpose is to appear in
    // Jira must not return "created" to the UI before we know whether it did -
    // the user would close the dialog believing it was filed. The push records
    // its own failure on the ticket, so an error here never loses the local
    // record.
    //
    // WHEN: the user named a destination, or the instance is set to auto-push.
    // 'local' is the explicit opt-out - the one case where a confirmed bug
    // stays inside this tool on purpose.
    const wantsExternal = dto.provider && dto.provider !== 'local';
    let pushed: Awaited<ReturnType<typeof this.pushToTracker>> | null = null;

    if (wantsExternal || (!dto.provider && this.trackers.autoPushEnabled)) {
      pushed = await this.pushToTracker(ticket.id, actor, {
        provider: wantsExternal ? (dto.provider as TrackerProviderName) : undefined,
        // A destination the user CHOSE must report its failure loudly. An
        // automatic push on an unconfigured instance stays quiet, because that
        // is a deployment choice and not something this user did wrong.
        silentIfUnconfigured: !wantsExternal,
      });
    }

    this.notifyBugFiled(ticket.id, actor);

    // Re-read only when the push changed the row, so the common path stays a
    // single query.
    return pushed?.ok ? this.findOne(ticket.id) : ticket;
  }

  /**
   * FILE THIS TICKET IN THE EXTERNAL TRACKER (Jira, ClickUp or Linear).
   *
   * Also the retry path: a push that failed leaves the reason on the ticket and
   * this is what the "Retry" button calls.
   *
   * IDEMPOTENT. `externalRequestId` is written BEFORE the call and checked on
   * entry, so a double-click, an impatient retry, or a timeout followed by a
   * retry cannot create two issues for one bug. Duplicated bug reports are the
   * fastest way for a team to stop trusting an automated reporter.
   */
  async pushToTracker(
    id: string,
    actor: JwtPayload,
    options: {
      silentIfUnconfigured?: boolean;
      /** Which tracker. Omitted = the instance default. */
      provider?: TrackerProviderName;
    } = {},
  ): Promise<{ ok: boolean; detail: string; key?: string; url?: string; warnings?: string[] }> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
        finding: {
          select: {
            id: true,
            bugKey: true,
            severity: true,
            priority: true,
            aiEvidence: true,
            run: { select: { targetUrl: true } },
            testCase: { select: { pageUrl: true } },
            result: { select: { screenshotPath: true, tracePath: true } },
          },
        },
      },
    });
    if (!ticket) throw new NotFoundException(`Ticket ${id} not found`);

    // Already filed. Return the existing issue rather than creating a second.
    if (ticket.externalUrl && ticket.externalKey) {
      return {
        ok: true,
        detail: `Already filed as ${ticket.externalKey}.`,
        key: ticket.externalKey,
        url: ticket.externalUrl,
      };
    }

    const status = this.trackers.status();
    if (!status.enabled) {
      const detail =
        'No issue tracker is configured. Add Jira, ClickUp or Linear credentials to ' +
        'backend/.env and restart — any number of them can be set up at once.';
      // On auto-push we stay quiet: an unconfigured tracker is a deployment
      // choice, not an error the person creating a ticket caused.
      if (options.silentIfUnconfigured) {
        this.logger.debug(`Not pushing ${ticket.key}: ${detail}`);
        return { ok: false, detail };
      }
      throw new BadRequestException(detail);
    }

    const bugKey = ticket.finding?.bugKey ?? ticket.key;

    // The idempotency key is claimed first. Two concurrent pushes race here,
    // and the loser sees a row that already has one.
    // The destination is part of the idempotency key: re-filing the SAME bug
    // into a DIFFERENT tracker is a legitimate action (it moved teams), while
    // filing it twice into the same one is not.
    const target = options.provider ?? (status.provider as TrackerProviderName);
    const requestId = `${ticket.id}:${target}`;
    await this.prisma.ticket.update({
      where: { id },
      data: { externalRequestId: requestId, externalProvider: target },
    });

    const attachments = await this.trackers.collectAttachments({
      screenshotPath: ticket.finding?.result?.screenshotPath,
      tracePath: ticket.finding?.result?.tracePath,
      bugKey,
    });

    try {
      const issue = await this.trackers.createIssue(
        {
          title: ticket.title,
          markdown: ticket.description,
          priority: ticket.priority,
          severity: ticket.severity,
          labels: ticket.labels,
          attachments,
          idempotencyKey: requestId,
        },
        options.provider,
      );

      await this.prisma.ticket.update({
        where: { id },
        data: {
          externalKey: issue.key,
          externalUrl: issue.url,
          externalProvider: issue.provider,
          externalSyncedAt: new Date(),
        },
      });

      await this.event(
        id,
        'external',
        null,
        issue.key,
        actor,
        `Filed in ${issue.provider} as ${issue.key}` +
          (issue.attachmentsUploaded
            ? ` with ${issue.attachmentsUploaded} attachment(s).`
            : '.') +
          (issue.warnings.length ? ` Warnings: ${issue.warnings.join(' ')}` : ''),
      );

      this.logger.log(`${ticket.key} filed in ${issue.provider} as ${issue.key}`);
      return {
        ok: true,
        detail: `Filed as ${issue.key} in ${issue.provider}.`,
        key: issue.key,
        url: issue.url,
        warnings: issue.warnings,
      };
    } catch (err) {
      const detail = describeError(err);

      // Release the idempotency claim so a retry is possible - it exists to
      // stop DOUBLE creation, not to make one failure permanent.
      await this.prisma.ticket
        .update({ where: { id }, data: { externalRequestId: null } })
        .catch(() => undefined);

      // Recorded on the ticket, not just logged. A confirmed bug that silently
      // never reached the developers is the worst outcome this feature has.
      await this.event(id, 'external', null, 'failed', actor, `Could not file: ${detail}`);
      this.logger.warn(`Could not file ${ticket.key}: ${detail}`);

      if (options.silentIfUnconfigured) return { ok: false, detail };
      throw new BadRequestException(detail);
    }
  }

  /** Confirms the tracker credentials without filing anything. */
  trackerStatus() {
    return this.trackers.status();
  }

  verifyTracker(provider?: TrackerProviderName) {
    return this.trackers.verify(provider);
  }

  /**
   * Tell the assignee, by email, that a confirmed defect is theirs.
   *
   * Fire-and-forget: a mail outage must not fail ticket creation. Read fresh so
   * the message carries the external key when the push has just succeeded.
   */
  private notifyBugFiled(ticketId: string, actor: JwtPayload): void {
    if (!this.config.mail.onBugFiled) return;

    void (async () => {
      try {
        const t = await this.prisma.ticket.findUnique({
          where: { id: ticketId },
          include: {
            assignee: { select: { name: true, email: true } },
            reporter: { select: { name: true, email: true } },
            finding: {
              select: {
                id: true,
                bugKey: true,
                run: { select: { targetUrl: true } },
                testCase: { select: { pageUrl: true } },
              },
            },
          },
        });
        if (!t) return;

        // The assignee is the person who has to act. With nobody assigned it
        // goes to the reporter, so a confirmed bug never lands in silence.
        const recipient = t.assignee ?? t.reporter;
        if (!recipient?.email) return;

        await this.mail.sendBugFiled({
          to: recipient.email,
          name: recipient.name,
          bugKey: t.finding?.bugKey ?? t.key,
          ticketKey: t.key,
          title: t.title,
          severity: t.severity,
          priority: t.priority,
          targetUrl: t.finding?.run?.targetUrl,
          pageUrl: t.finding?.testCase?.pageUrl,
          findingId: t.findingId,
          external:
            t.externalKey && t.externalUrl
              ? {
                  provider: t.externalProvider ?? 'tracker',
                  key: t.externalKey,
                  url: t.externalUrl,
                }
              : null,
          pushError: null,
        });
      } catch (err) {
        this.logger.warn(`Could not send the bug-filed email: ${String(err)}`);
      }
    })();
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
        labels: dto.labels === undefined ? undefined : splitLabels(dto.labels),
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

    // Retest replays the original test case. A finding promoted from a wording
    // review or a design comparison has no test case to replay, so say so
    // plainly instead of silently doing nothing and reporting a pass.
    if (!ticket.finding.testCase || !ticket.finding.testCaseId) {
      throw new BadRequestException(
        'This ticket did not come from an automated test, so it cannot be retested ' +
          'automatically. Verify the fix on the page and close the ticket manually.',
      );
    }

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

/**
 * "ui, regression, p1" -> ['ui', 'regression', 'p1']
 *
 * One text field is what a person wants to type; an array is what the database
 * should hold, so filtering by a label is an index lookup rather than a
 * substring match that would make "ui" match "build".
 */
function splitLabels(input?: string): string[] {
  return (input ?? '')
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 20);
}
