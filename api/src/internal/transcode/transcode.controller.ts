// api/src/internal/transcode/transcode.controller.ts
//
// Controller for video transcoding
// Handles POST /internal/transcode endpoint
//

import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { TranscodeDto } from './transcode.dto';
import { TranscodeService } from './transcode.service';
import { OIDCGuard } from '../oidc.guard';
import { AppLoggerService } from '../../core/logger/logger.service';

/**
 * Internal transcode endpoint
 * Protected by OIDC guard for Cloud Tasks authentication
 */
@Controller('internal/transcode')
@UseGuards(OIDCGuard)
export class TranscodeController {
  constructor(
    private readonly transcodeService: TranscodeService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * POST /internal/transcode
   *
   * Execute video transcoding job via Transcoder API
   */
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  async transcode(@Body() dto: TranscodeDto): Promise<void> {
    this.logger.debug('TranscodeRequestReceived', 'transcode', {
      inputUri: dto.inputUri,
      outputUri: dto.outputUri,
      recordId: dto.recordId,
    });

    try {
      await this.transcodeService.executeTranscodeJob({
        inputUri: dto.inputUri,
        outputUri: dto.outputUri,
        recordId: dto.recordId,
      });

      this.logger.log('TranscodeRequestCompleted', 'transcode', {
        recordId: dto.recordId,
      });
    } catch (error) {
      this.logger.error('TranscodeRequestError', 'transcode', {
        recordId: dto.recordId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }
}
