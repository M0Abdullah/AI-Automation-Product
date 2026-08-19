import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * HUMAN-READABLE KEYS: BUG-001, TICKET-014.
 *
 * People say "BUG-7 is fixed", never "finding 3be811ae-037c-422d is fixed". So
 * every confirmed defect and every ticket gets a short sequential key.
 *
 * Why a counter table instead of `count() + 1`: counting races. Two confirmations
 * a millisecond apart would both read 6 and both try to become BUG-007, and the
 * unique index would reject one of them. `increment` is atomic, so each caller
 * gets its own number.
 */
@Injectable()
export class CounterService {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns the next number for a sequence, creating the row on first use. */
  async next(name: string): Promise<number> {
    const row = await this.prisma.counter.upsert({
      where: { name },
      create: { name, value: 1 },
      update: { value: { increment: 1 } },
    });
    return row.value;
  }

  /** e.g. nextKey('bug', 'BUG') -> { number: 7, key: 'BUG-007' } */
  async nextKey(name: string, prefix: string, pad = 3) {
    const number = await this.next(name);
    return { number, key: `${prefix}-${String(number).padStart(pad, '0')}` };
  }
}
