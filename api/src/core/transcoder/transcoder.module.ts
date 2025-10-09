// api/src/core/transcoder/transcoder.module.ts

import { Module } from '@nestjs/common';
import { TranscoderService } from './transcoder.service';
import { LoggerModule } from '../logger/logger.module';

@Module({
  imports: [LoggerModule],
  providers: [TranscoderService],
  exports: [TranscoderService],
})
export class TranscoderModule {}
