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
import { CounterService } from '../common/counter.service';
import { BugCategory, Classification, CounterName, FindingStatus } from '../common/enums';
import { PrismaService } from '../prisma/prisma.service';

class ReviewDesignIssueDto {
  @IsIn(['NEW', 'ACCEPTED', 'DISMISSED'])
  status!: 'NEW' | 'ACCEPTED' | 'DISMISSED';
}

class PromoteDesignIssueDto {
  @IsOptional()
  @IsString()
  @Length(3, 200)
  title?: string;

  @IsOptional()
  @IsIn(['S1_BLOCKER', 'S2_MAJOR', 'S3_MINOR', 'S4_TRIVIAL'])
  severity?: string;
}

/**
 * Reviewing design deviations.
 *
 * Identical contract to content issues, deliberately: the platform has exactly
 * one rule for anything the AI or a heuristic merely SUSPECTS - a human decides
 * before it becomes a bug. Design comparison is the most tempting place to break
 * that rule and the worst place to do it, because a design file legitimately
 * differs from a shipped page in a hundred harmless ways.
 */
@Controller('design-issues')
export class DesignIssuesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly counters: CounterService,
  ) {}

  @Patch(':id')
  @RequireWrite()
  async review(
    @Param('id') id: string,
    @Body() dto: ReviewDesignIssueDto,
    @CurrentUser() user: { email: string },
  ) {
    return this.prisma.designIssue.update({
      where: { id },
      data: {
        status: dto.status,
        reviewedBy: dto.status === 'NEW' ? null : user.email,
        reviewedAt: dto.status === 'NEW' ? null : new Date(),
      },
    });
  }

  @Post(':id/promote')
  @RequireWrite()
  async promote(
    @Param('id') id: string,
    @Body() dto: PromoteDesignIssueDto,
    @CurrentUser() user: { email: string },
  ) {
    const issue = await this.prisma.designIssue.findUnique({
      where: { id },
      // At most one, but a list in the schema - see schema.prisma.
      include: { findings: { take: 1 } },
    });
    if (!issue) throw new NotFoundException(`Design issue ${id} not found`);

    // Idempotent: two clicks must not mint two BUG ids for one deviation.
    // Idempotent, and now the ONLY thing enforcing it: the unique index on
    // Finding.designIssueId had to go because it rejected every finding that
    // has no design issue. See the optional-unique note in schema.prisma.
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
        'This deviation was dismissed. Restore it before raising a bug.',
      );
    }

    const title =
      dto.title?.trim() ||
      `Design mismatch: ${issue.element} ${issue.property} is ${issue.actual}, design says ${issue.expected}`;

    const { key, number } = await this.counters.nextKey(CounterName.BUG, 'BUG');

    const finding = await this.prisma.finding.create({
      data: {
        source: 'DESIGN',
        runId: issue.runId,
        designIssueId: issue.id,
        title: title.slice(0, 200),
        status: FindingStatus.CONFIRMED,
        humanClassification: Classification.PRODUCT_BUG,
        aiCategory: BugCategory.UI_VISUAL,
        severity: dto.severity ?? 'S3_MINOR',
        triagedBy: user.email,
        triagedAt: new Date(),
        bugKey: key,
        bugNumber: number,
        // Keyed on the element and property, so the same mismatch on a later run
        // matches this defect instead of duplicating it.
        signature: `design:${issue.selector}:${issue.property}`,
        aiSummary:
          `${issue.property} of ${issue.element} is ${issue.actual}, but the design ` +
          `specifies ${issue.expected}.`,
        aiSuspectedCause: issue.note,
      },
    });

    await this.prisma.findingEvent.create({
      data: {
        findingId: finding.id,
        toStatus: FindingStatus.CONFIRMED,
        actor: user.email,
        note: 'Promoted from a design comparison after human review.',
      },
    });

    await this.prisma.designIssue.update({
      where: { id },
      data: { status: 'ACCEPTED', reviewedBy: user.email, reviewedAt: new Date() },
    });

    return { findingId: finding.id, bugKey: finding.bugKey, alreadyExisted: false };
  }
}
