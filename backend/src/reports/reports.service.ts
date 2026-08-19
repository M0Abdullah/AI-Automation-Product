import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { BrowserFactory } from '../browser/browser.factory';
import { unpackJson } from '../common/db-json';
import type { StepResult } from '../common/test-plan.types';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { type BugReportData, renderHtml, renderMarkdown } from './bug-report.builder';

/**
 * BUG REPORT GENERATION.
 *
 * The PDF is produced by Playwright printing the report HTML. That is a
 * deliberate choice: Chromium is already a dependency for testing, so there is
 * no extra PDF library, no font packaging, and the PDF looks exactly like the
 * HTML page. The screenshot is inlined as a data URI so the PDF is a single
 * self-contained file a developer can attach to anything.
 */
@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly browsers: BrowserFactory,
    private readonly config: AppConfigService,
  ) {}

  async markdown(findingId: string): Promise<{ filename: string; body: string }> {
    const data = await this.collect(findingId);
    return { filename: `${data.bugKey}.md`, body: renderMarkdown(data) };
  }

  async html(findingId: string): Promise<{ filename: string; body: string }> {
    const data = await this.collect(findingId, { inlineScreenshot: true });
    return { filename: `${data.bugKey}.html`, body: renderHtml(data) };
  }

  async pdf(findingId: string): Promise<{ filename: string; buffer: Buffer }> {
    const data = await this.collect(findingId, { inlineScreenshot: true });
    const html = renderHtml(data);

    const context = await this.browsers.newContext();
    const page = await context.newPage();
    try {
      // 'load' is enough: the document is self-contained, so there is no network
      // to wait for. waitUntil networkidle would just add a fixed delay.
      await page.setContent(html, { waitUntil: 'load' });
      const buffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: '<div></div>',
        footerTemplate:
          '<div style="width:100%;font:8pt sans-serif;color:#8a93a0;padding:0 14mm;">' +
          `<span>${escapeHtml(data.bugKey)}</span>` +
          '<span style="float:right">Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>' +
          '</div>',
        margin: { top: '14mm', bottom: '14mm', left: '14mm', right: '14mm' },
      });
      this.logger.log(`Generated ${data.bugKey}.pdf (${Math.round(buffer.length / 1024)}KB)`);
      return { filename: `${data.bugKey}.pdf`, buffer };
    } finally {
      await page.close().catch(() => undefined);
      await context.close().catch(() => undefined);
    }
  }

  // ------------------------------------------------------------- collection

  /** Gathers everything the report needs in one query. */
  private async collect(
    findingId: string,
    opts: { inlineScreenshot?: boolean } = {},
  ): Promise<BugReportData> {
    const finding = await this.prisma.finding.findUnique({
      where: { id: findingId },
      include: {
        testCase: true,
        run: { select: { name: true, targetUrl: true, requirements: true } },
        result: { include: { consoleLogs: true, networkLogs: true } },
        ticket: {
          select: { key: true, status: true, externalKey: true, externalUrl: true },
        },
      },
    });
    if (!finding) throw new NotFoundException(`Finding ${findingId} not found`);

    const r = finding.result;

    // A finding only gets a BUG key when it is confirmed. Before that, label it
    // clearly as a draft rather than inventing a permanent id.
    const bugKey = finding.bugKey ?? `DRAFT-${finding.id.slice(0, 8)}`;

    const evidence = unpackJson<{ consoleErrors?: string[]; apiErrors?: string[] }>(
      finding.aiEvidence,
      {},
    );

    const consoleErrors = r.consoleLogs
      .filter((c) => c.level === 'ERROR')
      .map((c) => (c.location ? `${c.message}  (${c.location})` : c.message));

    const apiErrors = r.networkLogs
      .filter((n) => n.isApiError || n.failureText)
      .map((n) =>
        n.failureText
          ? `${n.method} ${n.url} -> NETWORK FAILURE: ${n.failureText}`
          : `${n.method} ${n.url} -> ${n.status} ${n.statusText ?? ''}`.trim(),
      );

    let screenshotUrl: string | null = null;
    if (r.screenshotPath) {
      screenshotUrl = opts.inlineScreenshot
        ? await this.inlineScreenshot(r.screenshotPath)
        : `/api/artifacts/${r.screenshotPath}`;
    }

    return {
      bugKey,
      title: finding.testCase.title,
      status: finding.status,
      severity: finding.severity,
      priority: finding.priority ?? finding.testCase.priority,
      module: finding.module,
      build: finding.build,
      classification: finding.humanClassification,
      aiClassification: finding.aiClassification,
      aiConfidence: finding.aiConfidence,
      aiSummary: finding.aiSummary,
      aiSuspectedCause: finding.aiSuspectedCause,
      occurrences: finding.occurrences,
      createdAt: finding.createdAt,
      lastSeenAt: finding.lastSeenAt,
      triagedBy: finding.triagedBy,
      assignee: finding.assignee,
      note: finding.note,

      requirement: finding.testCase.requirement ?? finding.run.requirements.slice(0, 400),
      testCaseTitle: finding.testCase.title,
      testCasePriority: finding.testCase.priority,

      environment: {
        url: finding.run.targetUrl,
        runName: finding.run.name,
        browser: r.browserName,
        browserVersion: r.browserVersion,
        viewport: r.viewport,
        finalUrl: r.finalUrl,
      },

      failure: {
        errorType: r.errorType,
        errorMessage: r.errorMessage,
        expected: r.expected,
        actual: r.actual,
        failedStepLabel: r.failedStepLabel,
        durationMs: r.durationMs,
        attempt: r.attempt,
      },

      steps: unpackJson<StepResult[]>(r.stepResults, []),
      consoleErrors: consoleErrors.length ? consoleErrors : (evidence.consoleErrors ?? []),
      apiErrors: apiErrors.length ? apiErrors : (evidence.apiErrors ?? []),
      screenshotUrl,
      traceUrl: r.tracePath ? `/api/artifacts/${r.tracePath}` : null,
      ticket: finding.ticket,
    };
  }

  /**
   * Reads the PNG and returns a data URI, so the PDF has no external requests.
   * Skipped above ~4MB: a giant full-page screenshot would bloat the PDF beyond
   * what an email will accept, and the platform still has the original.
   */
  private async inlineScreenshot(relativePath: string): Promise<string | null> {
    try {
      const abs = path.resolve(this.config.artifactsDir, relativePath);
      const stat = await fs.stat(abs);
      if (stat.size > 4 * 1024 * 1024) {
        this.logger.warn(`Screenshot ${relativePath} is ${stat.size} bytes - omitted from PDF`);
        return null;
      }
      const buf = await fs.readFile(abs);
      return `data:image/png;base64,${buf.toString('base64')}`;
    } catch {
      return null;
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
