import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser, RequireWrite } from '../auth/auth.guard';
import type { JwtPayload } from '../auth/auth.service';
import { FindingStatus } from '../common/enums';
import { FindingNoteDto, TriageFindingDto } from './dto/triage.dto';
import { FindingsService } from './findings.service';

@Controller('findings')
export class FindingsController {
  constructor(private readonly findings: FindingsService) {}

  /** GET /api/findings?status=NEW - the triage inbox. */
  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: string,
    @Query('runId') runId?: string,
    @Query('scope') scope?: string,
  ) {
    if (status && !(status in FindingStatus)) {
      throw new BadRequestException(
        `Unknown status "${status}". Valid: ${Object.keys(FindingStatus).join(', ')}`,
      );
    }
    return this.findings.findAll({
      status,
      runId,
      scope: scope === 'team' ? 'team' : 'mine',
      userId: user.sub,
    });
  }

  @Get('stats')
  stats(@CurrentUser() user: JwtPayload, @Query('scope') scope?: string) {
    return this.findings.stats(scope === 'team' ? 'team' : 'mine', user.sub);
  }

  /** GET /api/findings/:id - the full bug report with all evidence. */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.findings.findOne(id);
  }

  /** POST /api/findings/:id/triage - the human verdict. */
  @RequireWrite()
  @Post(':id/triage')
  triage(@Param('id') id: string, @Body() dto: TriageFindingDto) {
    return this.findings.triage(id, dto);
  }

  /** POST /api/findings/:id/reopen - it came back. */
  @RequireWrite()
  @Post(':id/reopen')
  reopen(@Param('id') id: string, @Body() dto: FindingNoteDto) {
    return this.findings.reopen(id, dto);
  }

  @RequireWrite()
  @Post(':id/close')
  close(@Param('id') id: string, @Body() dto: FindingNoteDto) {
    return this.findings.close(id, dto);
  }

  @Post(':id/comments')
  comment(@Param('id') id: string, @Body() dto: FindingNoteDto) {
    return this.findings.comment(id, dto);
  }
}
