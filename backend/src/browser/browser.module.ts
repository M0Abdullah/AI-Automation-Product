import { Module } from '@nestjs/common';
import { BrowserFactory } from './browser.factory';
import { PageScannerService } from './page-scanner.service';
import { TestExecutorService } from './test-executor.service';

/**
 * The execution plane. Everything that touches a real browser lives here and
 * nowhere else, so it can later be lifted out into its own worker process or
 * container without changing the rest of the application.
 */
@Module({
  providers: [BrowserFactory, PageScannerService, TestExecutorService],
  // BrowserFactory is exported so ReportsModule can print PDFs with the same
  // Chromium instance instead of pulling in a separate PDF library.
  exports: [BrowserFactory, PageScannerService, TestExecutorService],
})
export class BrowserModule {}
