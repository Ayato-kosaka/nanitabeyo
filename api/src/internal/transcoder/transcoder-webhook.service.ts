// api/src/internal/transcoder/transcoder-webhook.service.ts
//
// Transcoder Job 完了通知の処理サービス
// 責務: Pub/Sub 通知を解析し、AudioMissing 時のリトライを実行
//

import { Injectable } from '@nestjs/common';
import {
  protos,
  TranscoderServiceClient,
} from '@google-cloud/video-transcoder';
import { AppLoggerService } from '../../core/logger/logger.service';
import { TranscoderService } from '../../core/transcoder/transcoder.service';
import { TranscoderJobLabels } from './transcoder-webhook.interface';

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

    switch (state) {
      case 'SUCCEEDED':
        this.handleSucceeded(jobId, jobDetails);
        break;

      case 'FAILED':
        await this.handleFailed(jobId, jobDetails);
        break;

      default:
        this.logger.debug(
          'TranscoderWebhookIgnoredState',
          'handleJobNotification',
          {
            jobId,
            state,
          },
        );
    }
  }

  /**
   * Job 成功時の処理
   */
  private handleSucceeded(
    jobId: string,
    jobDetails: protos.google.cloud.video.transcoder.v1.IJob,
  ): void {
    this.logger.log('TranscoderJobSucceeded', 'handleSucceeded', {
      jobId,
      labels: jobDetails.labels,
    });
  }

  /**
   * Job 失敗時の処理
   * AudioMissing の場合は video-only で再実行
   */
  private async handleFailed(
    jobId: string,
    jobDetails: protos.google.cloud.video.transcoder.v1.IJob,
  ): Promise<void> {
    const labels = jobDetails.labels as TranscoderJobLabels | null | undefined;
    const { table_name, column_name, record_id } = labels || {};

    if (!labels || !table_name || !record_id || !column_name) {
      this.logger.warn('TranscoderWebhookMissingLabel', 'handleFailed', {
        jobId,
        message: 'Missing required labels (table_name, column_name, record_id)',
      });
      return;
    }

    const errorStatus = jobDetails.error;
    const errorDescription = errorStatus?.details;
    const isAudioMissing = this.isAudioMissingError(errorStatus);

    this.logger.log('TranscoderJobFailed', 'handleFailed', {
      jobId,
      labels,
      errorStatus,
      isAudioMissing,
    });

    // AudioMissing かつ retry=0 の場合のみリトライ
    const retryCount = parseInt(labels.retry ?? '0', 10);
    if (isAudioMissing && retryCount === 0) {
      try {
        const inputUri = jobDetails.config?.inputs?.[0]?.uri;
        const outputUri = jobDetails.config?.output?.uri;
        if (!inputUri || !outputUri) {
          this.logger.error('TranscoderJobRetryError', 'handleFailed', {
            jobId,
            labels,
            jobDetails,
            message: 'InputUri or OutputUri is missing in jobDetails.config',
          });
          throw new Error('InputUri or OutputUri is missing');
        }
        await this.transcoderService.createTranscodeJob({
          inputUri,
          outputUri,
          labels: {
            ...labels,
            retry: '1',
            video_only: 'true',
          },
        });
      } catch (error) {
        this.logger.error('TranscoderJobRetryError', 'handleFailed', {
          jobId,
          labels,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }

      return;
    }

    // その他の失敗はログ記録のみ
    this.logger.error('TranscoderJobFailedPermanent', 'handleFailed', {
      jobId,
      labels,
      jobDetails,
      errorDescription,
    });
  }

  private isAudioMissingError(
    errorStatus: protos.google.rpc.IStatus | null | undefined,
  ): boolean {
    if (!errorStatus) return false;

    if (errorStatus.message?.includes('with an audio track')) {
      return true;
    }
    return false;
  }

  /**
   * Transcoder Job の詳細情報を取得
   */
  private async getJobDetails(
    jobId: string,
  ): Promise<protos.google.cloud.video.transcoder.v1.IJob> {
    try {
      const [job] = await this.client.getJob({ name: jobId });

      return job;
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
