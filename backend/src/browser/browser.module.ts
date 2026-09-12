import { Module } from '@nestjs/common';
import { BrowserFactory } from './browser.factory';
import { PageScannerService } from './page-scanner.service';
import { SiteCrawlerService } from './site-crawler.service';
import { SessionService } from './session.service';
import { TestExecutorService } from './test-executor.service';

/**
 * The execution plane. Everything that touches a real browser lives here and
 * nowhere else, so it can later be lifted out into its own worker process or
 * container without changing the rest of the application.
 */
@Module({
  providers: [BrowserFactory, PageScannerService, SiteCrawlerService, TestExecutorService, SessionService],
  exports: [BrowserFactory, PageScannerService, SiteCrawlerService, TestExecutorService, SessionService],
})
export class BrowserModule {}
