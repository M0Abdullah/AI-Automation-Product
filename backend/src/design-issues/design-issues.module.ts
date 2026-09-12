import { Module } from '@nestjs/common';
import { CounterService } from '../common/counter.service';
import { DesignIssuesController } from './design-issues.controller';

@Module({
  controllers: [DesignIssuesController],
  providers: [CounterService],
})
export class DesignIssuesModule {}
