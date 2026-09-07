import { Global, Module } from '@nestjs/common';
import { TrackerService } from './tracker.service';

/**
 * Global for the same reason as MailModule: the tickets module files issues,
 * and the system controller reports whether a tracker is configured at all.
 */
@Global()
@Module({
  providers: [TrackerService],
  exports: [TrackerService],
})
export class TrackersModule {}
