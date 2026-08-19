import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, RequireWrite } from '../auth/auth.guard';
import type { JwtPayload } from '../auth/auth.service';
import {
  CreateTicketDto,
  LinkExternalDto,
  TicketCommentDto,
  UpdateTicketDto,
} from './dto/ticket.dto';
import { TicketsService } from './tickets.service';

@Controller()
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  /** POST /api/findings/:id/tickets — create a ticket from a confirmed bug. */
  @RequireWrite()
  @Post('findings/:id/tickets')
  create(
    @Param('id') findingId: string,
    @Body() dto: CreateTicketDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.tickets.createFromFinding(findingId, dto, user);
  }

  @Get('tickets')
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: string,
    @Query('assigneeId') assigneeId?: string,
    @Query('scope') scope?: string,
  ) {
    return this.tickets.findAll({
      status,
      assigneeId,
      scope: scope === 'team' ? 'team' : 'mine',
      userId: user.sub,
    });
  }

  @Get('tickets/stats')
  stats(@CurrentUser() user: JwtPayload, @Query('scope') scope?: string) {
    return this.tickets.stats(scope === 'team' ? 'team' : 'mine', user.sub);
  }

  /** Accepts the uuid or the human key (TICKET-007). */
  @Get('tickets/:id')
  findOne(@Param('id') id: string) {
    return this.tickets.findOne(id);
  }

  @RequireWrite()
  @Patch('tickets/:id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTicketDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.tickets.update(id, dto, user);
  }

  /** Comments are open to every signed-in role, including DEV and VIEWER. */
  @Post('tickets/:id/comments')
  comment(
    @Param('id') id: string,
    @Body() dto: TicketCommentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.tickets.comment(id, dto, user);
  }

  /** POST /api/tickets/:id/retest — the Ready-for-Retest handoff. */
  @Post('tickets/:id/retest')
  retest(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.tickets.retest(id, user);
  }

  /** POST /api/tickets/:id/external — record the Jira/Linear/GitHub issue. */
  @RequireWrite()
  @Post('tickets/:id/external')
  linkExternal(
    @Param('id') id: string,
    @Body() dto: LinkExternalDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.tickets.linkExternal(id, dto, user);
  }
}
