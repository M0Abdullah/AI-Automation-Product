import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { SystemController } from './system.controller';

@Module({
  imports: [LlmModule],
  controllers: [SystemController],
})
export class SystemModule {}
