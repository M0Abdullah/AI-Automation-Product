import { Controller, Get, Header, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ReportsService } from './reports.service';

/**
 * Bug report in three formats, all from the same builder:
 *   .md   -> paste into Jira, Slack, a PR description
 *   .html -> read in the browser / print yourself
 *   .pdf  -> attach to an email, hand to a manager
 */
@Controller('findings/:id/report')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('markdown')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  async markdown(@Param('id') id: string) {
    const { body } = await this.reports.markdown(id);
    return body;
  }

  @Get('html')
  async html(@Param('id') id: string, @Res() res: Response) {
    const { body } = await this.reports.html(id);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(body);
  }

  /**
   * Streamed with an explicit filename so the browser saves it as BUG-007.pdf
   * rather than "report".
   */
  @Get('pdf')
  async pdf(@Param('id') id: string, @Res() res: Response) {
    const { filename, buffer } = await this.reports.pdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }
}
