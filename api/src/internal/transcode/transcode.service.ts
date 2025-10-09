// api/src/internal/transcode/transcode.service.ts
//
// Service for handling transcode job execution
//

import { Injectable } from '@nestjs/common';
import { TranscoderService } from '../../core/transcoder/transcoder.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { TranscodeJobPayload } from './transcode-job.interface';

@Injectable()
export class TranscodeService {
  constructor(
    private readonly transcoder: TranscoderService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * Execute transcode job
   * Called by Cloud Tasks worker
   */
  async executeTranscodeJob(payload: TranscodeJobPayload): Promise<void> {
    const { inputUri, outputUri, recordId } = payload;

    this.logger.log('TranscodeJobStarted', 'executeTranscodeJob', {
      inputUri,
      outputUri,
      recordId,
    });

    try {
      const jobName = await this.transcoder.createTranscodeJob({
        inputUri,
        outputUri,
        recordId,
      });

      this.logger.log('TranscodeJobCreated', 'executeTranscodeJob', {
        jobName,
        recordId,
      });

      // Note: The actual transcoding happens asynchronously in Transcoder API
      // We just create the job here and let Transcoder handle the rest
      // Status updates can be implemented via Pub/Sub notifications in the future
    } catch (error) {
      this.logger.error('TranscodeJobError', 'executeTranscodeJob', {
        inputUri,
        outputUri,
        recordId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }
}
