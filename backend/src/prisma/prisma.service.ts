import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Connected to MongoDB');
    } catch (err) {
      // The two ways this fails in practice, named. "Connection refused" with no
      // guidance sends people to the wrong place - usually their firewall.
      this.logger.error(
        'Could not connect to MongoDB. Check DATABASE_URL in backend/.env, and that the ' +
          'server is running: docker compose up -d (or use a MongoDB Atlas mongodb+srv:// URL).',
      );
      throw err;
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
