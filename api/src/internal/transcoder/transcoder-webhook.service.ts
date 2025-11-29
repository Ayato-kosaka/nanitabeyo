// api/src/internal/transcoder/transcoder-webhook.service.ts
//
// Transcoder Job 完了通知の処理サービス
// 責務: Pub/Sub 通知を解析し、AudioMissing 時のリトライを実行
//

import { Injectable } from '@nestjs/common';
import { TranscoderServiceClient } from '@google-cloud/video-transcoder';
import { AppLoggerService } from '../../core/logger/logger.service';
import { TranscoderService } from '../../core/transcoder/transcoder.service';
import {
  TranscoderJobLabels,
  TranscoderJobFailureDetail,
} from './transcoder-webhook.interface';

/**
 * AudioMissing エラーの判定文字列
 */
const AUDIO_MISSING_ERROR = 'AudioMissing';

@Injectable()
export class TranscoderWebhookService {
  private client: TranscoderServiceClient;

  constructor(
    private readonly logger: AppLoggerService,
    private readonly transcoderService: TranscoderService,
  ) {
    this.client = new TranscoderServiceClient();
  }

  /**
   * Transcoder Job 完了通知を処理
   * @param jobId Transcoder Job ID（例: projects/xxx/locations/xxx/jobs/xxx）
   * @param state Job の状態（SUCCEEDED, FAILED, etc.）
   */
  async handleJobNotification(jobId: string, state: string): Promise<void> {
    this.logger.log('TranscoderWebhookReceived', 'handleJobNotification', {
      jobId,
      state,
    });

    // Job の詳細情報を取得
    const jobDetails = await this.getJobDetails(jobId);
    const labels = jobDetails.labels as TranscoderJobLabels | undefined;
    const dishMediaId = labels?.dish_media_id;
    const retryCount = parseInt(labels?.retry || '0', 10);
    const inputUri = jobDetails.inputUri;
    const outputUri = jobDetails.outputUri;

    if (!dishMediaId) {
      this.logger.warn(
        'TranscoderWebhookMissingLabel',
        'handleJobNotification',
        {
          jobId,
          state,
          message: 'dish_media_id label not found',
        },
      );
      return;
    }

    switch (state) {
      case 'SUCCEEDED':
        await this.handleSucceeded(jobId, dishMediaId);
        break;

      case 'FAILED':
        await this.handleFailed(
          jobId,
          dishMediaId,
          retryCount,
          inputUri || '',
          outputUri || '',
          jobDetails.error,
        );
        break;

      default:
        this.logger.debug(
          'TranscoderWebhookIgnoredState',
          'handleJobNotification',
          {
            jobId,
            dishMediaId,
            state,
          },
        );
    }
  }

  /**
   * Job 成功時の処理
   */
  private async handleSucceeded(
    jobId: string,
    dishMediaId: string,
  ): Promise<void> {
    this.logger.log('TranscoderJobSucceeded', 'handleSucceeded', {
      jobId,
      dishMediaId,
    });
  }

  /**
   * Job 失敗時の処理
   * AudioMissing の場合は video-only で再実行
   */
  private async handleFailed(
    jobId: string,
    dishMediaId: string,
    retryCount: number,
    inputUri: string,
    outputUri: string,
    error: TranscoderJobFailureDetail | null | undefined,
  ): Promise<void> {
    const errorDescription = error?.description || '';
    const isAudioMissing = errorDescription.includes(AUDIO_MISSING_ERROR);

    this.logger.log('TranscoderJobFailed', 'handleFailed', {
      jobId,
      dishMediaId,
      retryCount,
      errorDescription,
      isAudioMissing,
    });

    // AudioMissing かつ retry=0 の場合のみリトライ
    if (isAudioMissing && retryCount === 0) {
      this.logger.log('TranscoderJobRetryingVideoOnly', 'handleFailed', {
        jobId,
        dishMediaId,
        inputUri,
        outputUri,
      });

      await this.transcoderService.createTranscodeJob({
        inputUri,
        outputUri,
        recordId: dishMediaId,
        retry: 1,
        videoOnly: true,
      });

      return;
    }

    // その他の失敗はログ記録のみ
    this.logger.error('TranscoderJobFailedPermanent', 'handleFailed', {
      jobId,
      dishMediaId,
      retryCount,
      errorDescription,
    });
  }

  /**
   * Transcoder Job の詳細情報を取得
   */
  private async getJobDetails(jobId: string): Promise<{
    labels: Record<string, string> | null | undefined;
    inputUri: string | null | undefined;
    outputUri: string | null | undefined;
    error: TranscoderJobFailureDetail | null | undefined;
  }> {
    try {
      const [job] = await this.client.getJob({ name: jobId });
      return {
        labels: job.labels,
        inputUri: job.inputUri,
        outputUri: job.outputUri,
        error: job.error as TranscoderJobFailureDetail | null | undefined,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      const isNotFound =
        errorMessage.includes('NOT_FOUND') ||
        errorMessage.includes('not found');
      const isPermissionDenied =
        errorMessage.includes('PERMISSION_DENIED') ||
        errorMessage.includes('permission');

      this.logger.error('GetJobDetailsError', 'getJobDetails', {
        jobId,
        error: errorMessage,
        errorType: isNotFound
          ? 'NOT_FOUND'
          : isPermissionDenied
            ? 'PERMISSION_DENIED'
            : 'UNKNOWN',
      });
      throw error;
    }
  }
}
