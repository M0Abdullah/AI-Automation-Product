import { Module } from '@nestjs/common';
import { CounterService } from '../common/counter.service';
import { ReportsModule } from '../reports/reports.module';
import { RunsModule } from '../runs/runs.module';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

@Module({
  // ReportsModule: the ticket description is the generated bug report.
  // RunsModule:    the retest button reruns the linked test case.
  imports: [ReportsModule, RunsModule],
  controllers: [TicketsController],
  providers: [TicketsService, CounterService],
})
export class TicketsModule {}
