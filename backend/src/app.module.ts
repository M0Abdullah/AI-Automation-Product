import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ArtifactsModule } from './artifacts/artifacts.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/auth.guard';
import { BrowserModule } from './browser/browser.module';
import { CounterService } from './common/counter.service';
import { SystemController } from './common/system.controller';
import { AppConfigModule } from './config/config.module';
import { FindingsModule } from './findings/findings.module';
import { LlmModule } from './llm/llm.module';
import { PolicyModule } from './policy/policy.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectsModule } from './projects/projects.module';
import { ReportsModule } from './reports/reports.module';
import { ResultsModule } from './results/results.module';
import { RunsModule } from './runs/runs.module';
import { SecretsModule } from './secrets/secrets.module';
import { TestCasesModule } from './test-cases/test-cases.module';
import { TicketsModule } from './tickets/tickets.module';

/**
 * Module map, grouped by layer:
 *
 *  infrastructure : AppConfig, Prisma, Secrets, Auth        (global)
 *  capability     : Llm (brain), Browser (hands), Policy (gate)
 *  product        : Projects, Runs, TestCases, Results, Findings,
 *                   Tickets, Reports, Artifacts
 *
 * JwtAuthGuard is registered as a GLOBAL guard, so the API is default-deny:
 * a new endpoint is protected unless it is explicitly marked @Public().
 */
@Module({
  imports: [
    // infrastructure
    AppConfigModule,
    PrismaModule,
    SecretsModule,
    AuthModule,
    // capability
    LlmModule,
    BrowserModule,
    PolicyModule,
    // product
    ProjectsModule,
    RunsModule,
    TestCasesModule,
    ResultsModule,
    FindingsModule,
    ReportsModule,
    TicketsModule,
    ArtifactsModule,
  ],
  controllers: [SystemController],
  providers: [CounterService, { provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule {}
