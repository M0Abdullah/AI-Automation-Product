import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
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
        // A list in the schema, at most one in practice. See the
        // optional-unique note in schema.prisma - a unique FK on
        // Finding.resultId would reject every finding that has no result.
        findings: {
          select: { id: true, status: true, aiClassification: true, aiSummary: true },
          take: 1,
        },
      },
    });
    if (!result) throw new NotFoundException(`Result ${id} not found`);

    // The array is collapsed back to `finding` so the API shape is unchanged.
    // The 1:N is a MongoDB indexing detail; it has no business meaning and no
    // client should have to know about it.
    const { findings, ...rest } = result;

    return {
      ...rest,
      finding: findings[0] ?? null,
      // Pre-split so the frontend does not need to filter.
      consoleErrors: result.consoleLogs.filter((c) => c.level === 'ERROR'),
      consoleWarnings: result.consoleLogs.filter((c) => c.level === 'WARNING'),
      apiErrors: result.networkLogs.filter((n) => n.isApiError || Boolean(n.failureText)),
    };
  }
}
