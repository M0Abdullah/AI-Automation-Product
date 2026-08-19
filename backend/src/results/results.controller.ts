import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { hydrateResult } from '../common/hydrate';
import { PrismaService } from '../prisma/prisma.service';

/**
 * One result with every piece of evidence attached: step timeline, console
 * errors, network/API errors, screenshot and trace paths.
 *
 * This is the payload behind the "why did it fail" panel in the UI.
 */
@Controller('results')
export class ResultsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const result = await this.prisma.testResult.findUnique({
      where: { id },
      include: {
        consoleLogs: { orderBy: { at: 'asc' } },
        networkLogs: { orderBy: { at: 'asc' } },
        testCase: { select: { id: true, title: true, priority: true, requirement: true } },
        run: { select: { id: true, name: true, targetUrl: true } },
        finding: { select: { id: true, status: true, aiClassification: true, aiSummary: true } },
      },
    });
    if (!result) throw new NotFoundException(`Result ${id} not found`);

    return {
      ...hydrateResult(result as unknown as Record<string, unknown>),
      // Pre-split so the frontend does not need to filter.
      consoleErrors: result.consoleLogs.filter((c) => c.level === 'ERROR'),
      consoleWarnings: result.consoleLogs.filter((c) => c.level === 'WARNING'),
      apiErrors: result.networkLogs.filter((n) => n.isApiError || Boolean(n.failureText)),
    };
  }
}
