import { Module } from '@nestjs/common';
import { CounterService } from '../common/counter.service';
import { ContentIssuesController } from './content-issues.controller';

@Module({
  controllers: [ContentIssuesController],
  providers: [CounterService],
})
export class ContentIssuesModule {}
