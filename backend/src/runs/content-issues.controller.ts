import {
  BadRequestException,
  Body,
  Controller,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { CurrentUser, RequireWrite } from '../auth/auth.guard';
import { BugCategory, Classification, FindingStatus } from '../common/enums';
import { CounterName } from '../common/enums';
import { CounterService } from '../common/counter.service';
import { PrismaService } from '../prisma/prisma.service';

class ReviewContentIssueDto {
  /** ACCEPTED = a real wording bug. DISMISSED = a brand name or false alarm. */
  @IsIn(['NEW', 'ACCEPTED', 'DISMISSED'])
  status!: 'NEW' | 'ACCEPTED' | 'DISMISSED';
}

/**
 * Reviewing the advisory content list.
 *
 * Dismissals are stored rather than hidden client-side: the same brand name will
 * be flagged on every future run of the same page, and a reviewer should only
 * have to say "that is our product name" once.
 */
class PromoteContentIssueDto {
  /** Optional override; defaults to a title built from the wording problem. */
  @IsOptional()
  @IsString()
  @Length(3, 200)
  title?: string;

  @IsOptional()
  @IsIn(['S1_BLOCKER', 'S2_MAJOR', 'S3_MINOR', 'S4_TRIVIAL'])
  severity?: string;
}

@Controller('content-issues')
export class ContentIssuesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly counters: CounterService,
  ) {}

  @Patch(':id')
  @RequireWrite()
  async review(
    @Param('id') id: string,
    @Body() dto: ReviewContentIssueDto,
    @CurrentUser() user: { email: string },
  ) {
    return this.prisma.contentIssue.update({
      where: { id },
      data: {
        status: dto.status,
        reviewedBy: dto.status === 'NEW' ? null : user.email,
        reviewedAt: dto.status === 'NEW' ? null : new Date(),
      },
    });
  }

  /**
   * Turn a confirmed wording problem into a real, reportable defect.
   *
   * This is the step that makes the content pass worth having. Detection stays
   * advisory - it must, because a spell-check over real copy will always flag
   * some brand names - but once a HUMAN says "yes, that is a typo", it deserves
   * the same treatment as any other bug: a BUG id, a PDF, and a ticket.
   *
   * The human in the loop is what keeps the "no false bug reports" claim true.
   * Nothing here can create a defect on its own.
   */
  @Post(':id/promote')
  @RequireWrite()
  async promote(
    @Param('id') id: string,
    @Body() dto: PromoteContentIssueDto,
    @CurrentUser() user: { email: string },
  ) {
    const issue = await this.prisma.contentIssue.findUnique({
      where: { id },
      // At most one, but a list in the schema - see schema.prisma.
      include: { findings: { take: 1 } },
    });
    if (!issue) throw new NotFoundException(`Content issue ${id} not found`);

    // Idempotent: clicking twice must not mint a second BUG id for one typo.
    //
    // This check is now the ONLY thing enforcing it. The database used to back
    // it up with a unique index on Finding.contentIssueId, but that index
    // rejected every finding that has no content issue - which is almost all of
    // them - so it had to go.
    const promotedAlready = issue.findings[0];
    if (promotedAlready) {
      return {
        findingId: promotedAlready.id,
        bugKey: promotedAlready.bugKey,
        alreadyExisted: true,
      };
    }

    if (issue.status === 'DISMISSED') {
      throw new BadRequestException(
        'This suggestion was dismissed as not an issue. Restore it before raising a bug.',
      );
    }

    const title =
      dto.title?.trim() ||
      `${KIND_TITLE[issue.kind] ?? 'Wording problem'}: "${issue.text.slice(0, 80)}"`;

    const { key, number } = await this.counters.nextKey(CounterName.BUG, 'BUG');

    const finding = await this.prisma.finding.create({
      data: {
        source: 'CONTENT',
        runId: issue.runId,
        contentIssueId: issue.id,
        title,
        // Confirmed on creation: a human just asserted it is real, so making
        // them triage it again would be busywork.
        status: FindingStatus.CONFIRMED,
        humanClassification: Classification.PRODUCT_BUG,
        aiCategory: BugCategory.CONTENT,
        severity: dto.severity ?? 'S4_TRIVIAL',
        triagedBy: user.email,
        triagedAt: new Date(),
        bugKey: key,
        bugNumber: number,
        // The signature keys on the exact text, so the same typo found again on
        // a later run matches this defect instead of creating a duplicate.
        signature: `content:${issue.kind}:${issue.text.trim().toLowerCase()}`,
        aiSummary: issue.reason ?? `${issue.kind} found while reviewing the page copy.`,
        aiSuspectedCause: issue.suggestion ? `Should read: ${issue.suggestion}` : null,
        aiConfidence: issue.confidence,
      },
    });

    await this.prisma.findingEvent.create({
      data: {
        findingId: finding.id,
        toStatus: FindingStatus.CONFIRMED,
        actor: user.email,
        note: 'Promoted from a wording suggestion after human review.',
      },
    });

    await this.prisma.contentIssue.update({
      where: { id },
      data: { status: 'ACCEPTED', reviewedBy: user.email, reviewedAt: new Date() },
    });

    return { findingId: finding.id, bugKey: finding.bugKey, alreadyExisted: false };
  }
}

/** Report-friendly wording for each kind of copy problem. */
const KIND_TITLE: Record<string, string> = {
  TYPO: 'Typo',
  GRAMMAR: 'Grammar error',
  LABEL: 'Incorrect field label',
  CASING: 'Inconsistent capitalisation',
  PLACEHOLDER: 'Placeholder text in production copy',
  INCONSISTENT: 'Inconsistent wording',
};
