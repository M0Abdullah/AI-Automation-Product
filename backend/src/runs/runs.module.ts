import { Module } from '@nestjs/common';
import { BrowserModule } from '../browser/browser.module';
import { LlmModule } from '../llm/llm.module';
import { PolicyModule } from '../policy/policy.module';
import { ProjectsModule } from '../projects/projects.module';
import { RunPipelineService } from './run-pipeline.service';
import { RunsController } from './runs.controller';
import { RunsService } from './runs.service';

@Module({
  imports: [BrowserModule, LlmModule, PolicyModule, ProjectsModule],
  controllers: [RunsController],
  providers: [RunsService, RunPipelineService],
  // Exported so the test-cases and findings modules can trigger a retest.
  exports: [RunPipelineService],
})
export class RunsModule {}
