import { Module } from '@nestjs/common';
import { PolicyModule } from '../policy/policy.module';
import { RunsModule } from '../runs/runs.module';
import { TestCasesController } from './test-cases.controller';
import { TestCasesService } from './test-cases.service';

@Module({
  imports: [PolicyModule, RunsModule],
  controllers: [TestCasesController],
  providers: [TestCasesService],
})
export class TestCasesModule {}
