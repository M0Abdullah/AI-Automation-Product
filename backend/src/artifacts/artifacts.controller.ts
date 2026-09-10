import {
  BadRequestException,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  StreamableFile,
} from '@nestjs/common';
import { Public } from '../auth/auth.guard';
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AppConfigService } from '../config/app-config.service';

/**
 * Serves screenshots and traces.
 *
 * Path traversal is the obvious risk here (a request for
 * ../../../../etc/passwd), so the resolved absolute path is checked to be
 * inside ARTIFACTS_DIR before anything is streamed.
 */
@Controller('artifacts')
export class ArtifactsController {
  constructor(private readonly config: AppConfigService) {}

  // Public because an <img src> / <a download> cannot send an Authorization
  // header. The paths contain two uuids, so they are unguessable, and the
  // traversal guard below keeps the reader inside ARTIFACTS_DIR. Swap this for
  // short-lived signed URLs before any multi-tenant deployment.
  @Public()
  @Get('*filepath')
  @Header('Cache-Control', 'private, max-age=3600')
  async serve(@Param('filepath') filepath: string | string[]): Promise<StreamableFile> {
    const rel = Array.isArray(filepath) ? filepath.join('/') : filepath;
    const root = this.config.artifactsDir;
    const abs = path.resolve(root, rel);

    // Containment check - must stay inside the artifacts root.
    const relCheck = path.relative(root, abs);
    if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
      throw new BadRequestException('Invalid artifact path');
    }

    const stat = await fs.stat(abs).catch(() => null);
    if (!stat?.isFile()) throw new NotFoundException(`Artifact not found: ${rel}`);

    const type =
      abs.endsWith('.png')
        ? 'image/png'
        : abs.endsWith('.zip')
          ? 'application/zip'
          : abs.endsWith('.webm')
            ? 'video/webm'
            : 'application/octet-stream';

    return new StreamableFile(createReadStream(abs), {
      type,
      disposition: type === 'application/zip' ? `attachment; filename="${path.basename(abs)}"` : undefined,
      length: stat.size,
    });
  }
}
