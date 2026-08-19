import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.guard';
import type { JwtPayload } from '../auth/auth.service';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** GET /api/dashboard?scope=mine|team - every number the landing page needs. */
  @Get()
  overview(@CurrentUser() user: JwtPayload, @Query('scope') scope?: string) {
    return this.dashboard.overview(scope === 'team' ? 'team' : 'mine', user.sub);
  }
}
