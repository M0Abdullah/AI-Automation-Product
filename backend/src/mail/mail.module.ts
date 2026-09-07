import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';

/**
 * Global, like config and secrets.
 *
 * Notifications are cross-cutting — auth sends sign-in alerts, the run pipeline
 * sends run summaries, tickets send assignment mail — and threading an import
 * through every one of those modules adds nothing but ceremony.
 */
@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
