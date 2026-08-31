import { Module } from '@nestjs/common';
import { BrowserModule } from '../browser/browser.module';
import { LlmModule } from '../llm/llm.module';
import { PolicyModule } from '../policy/policy.module';
import { ProjectsModule } from '../projects/projects.module';
import { RunPipelineService } from './run-pipeline.service';
import { RunsController } from './runs.controller';
import { CounterService } from '../common/counter.service';
import { DesignModule } from '../design/design.module';
import { ContentIssuesController } from './content-issues.controller';
import { DesignIssuesController } from './design-issues.controller';
import { RunsService } from './runs.service';

@Module({
  imports: [DesignModule, BrowserModule, LlmModule, PolicyModule, ProjectsModule],
  controllers: [RunsController, ContentIssuesController, DesignIssuesController],
  providers: [RunsService, RunPipelineService, CounterService],
  // Exported so the test-cases and findings modules can trigger a retest.
  exports: [RunPipelineService],
})
export class RunsModule {}
