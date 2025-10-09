// api/src/internal/transcode/transcode.module.ts
//
// Module for transcode functionality
//

import { Module } from '@nestjs/common';
import { TranscodeController } from './transcode.controller';
import { TranscodeService } from './transcode.service';
import { CoreModule } from '../../core/core.module';

@Module({
  imports: [CoreModule],
  controllers: [TranscodeController],
  providers: [TranscodeService],
  exports: [TranscodeService],
})
export class TranscodeModule {}
