import { Module } from '@nestjs/common';
import { BrowserModule } from '../browser/browser.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/**
 * Imports BrowserModule because the PDF is printed by Playwright - the same
 * Chromium that runs the tests, so no extra PDF dependency exists.
 */
@Module({
  imports: [BrowserModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
