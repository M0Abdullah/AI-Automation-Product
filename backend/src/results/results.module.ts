import { Module } from '@nestjs/common';
import { ResultsController } from './results.controller';

@Module({
  controllers: [ResultsController],
})
export class ResultsModule {}
