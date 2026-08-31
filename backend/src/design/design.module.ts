import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { FigmaService } from './figma.service';

@Module({
  imports: [AppConfigModule],
  providers: [FigmaService],
  exports: [FigmaService],
})
export class DesignModule {}
