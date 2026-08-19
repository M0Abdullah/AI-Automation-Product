import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as fs from 'node:fs/promises';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AppConfigService } from './config/app-config.service';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const config = app.get(AppConfigService);

  // Every route lives under /api, so the frontend base URL is one constant.
  app.setGlobalPrefix('api');

  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip properties the DTO does not declare
      forbidNonWhitelisted: true, // and reject the request if extras were sent
      transform: true, // apply @Type conversions
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  // Evidence directory must exist before the first screenshot is written.
  await fs.mkdir(config.artifactsDir, { recursive: true });

  // Close Chromium and Postgres cleanly on Ctrl+C / container stop.
  app.enableShutdownHooks();

  await app.listen(config.port);

  logger.log(`API      http://localhost:${config.port}/api`);
  logger.log(`Health   http://localhost:${config.port}/api/health`);
  logger.log(`LLM      ${config.llm.provider} / ${config.llm.model}`);
  logger.log(`Evidence ${config.artifactsDir}`);
}

void bootstrap();
