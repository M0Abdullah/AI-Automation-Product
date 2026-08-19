import { Module } from '@nestjs/common';
import { CounterService } from '../common/counter.service';
import { FindingsController } from './findings.controller';
import { FindingsService } from './findings.service';

@Module({
  controllers: [FindingsController],
  providers: [FindingsService, CounterService],
})
export class FindingsModule {}
