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
import { PrismaService } from '../../prisma/prisma.service';
import { MediaProcessingStatus } from '@shared/v1/res';

@Injectable()
export class TranscoderWebhookService {
  private client: TranscoderServiceClient;

  constructor(
    private readonly logger: AppLoggerService,
    private readonly transcoderService: TranscoderService,
    private readonly prisma: PrismaService,
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
        await this.handleSucceeded(jobId, jobDetails);
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
   * #511 【設計】dish_media テーブルの processing_status を更新
   */
  private async updateDishMediaProcessingStatus(
    recordId: string,
    status: MediaProcessingStatus,
  ): Promise<void> {
    try {
      await this.prisma.prisma.dish_media.update({
        where: { id: recordId },
        data: {
          media_processing_status: status,
          updated_at: new Date(),
        },
      });

      this.logger.log('DishMediaProcessingStatusUpdated', 'updateDishMediaProcessingStatus', {
        recordId,
        status,
      });
    } catch (error) {
      this.logger.error('UpdateDishMediaProcessingStatusError', 'updateDishMediaProcessingStatus', {
        recordId,
        status,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // ステータス更新失敗はトランスコード処理自体の失敗とは別扱い（ログのみ）
    }
  }

  /**
   * Job 成功時の処理
   */
  private async handleSucceeded(
    jobId: string,
    jobDetails: protos.google.cloud.video.transcoder.v1.IJob,
  ): Promise<void> {
    this.logger.log('TranscoderJobSucceeded', 'handleSucceeded', {
      jobId,
      labels: jobDetails.labels,
    });

    // #511 【設計】dish_media テーブルの場合はステータスを completed に更新
    const labels = jobDetails.labels as TranscoderJobLabels | null | undefined;
    if (labels?.table_name === 'dish_media' && labels.record_id) {
      await this.updateDishMediaProcessingStatus(labels.record_id, 'completed');
    }
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
        const { inputUri, outputUri } = jobDetails;
        if (!inputUri || !outputUri)
          throw new Error('InputUri or OutputUri is missing');
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

    // #511 【設計】dish_media テーブルの場合はステータスを failed に更新
    if (table_name === 'dish_media' && record_id) {
      await this.updateDishMediaProcessingStatus(record_id, 'failed');
    }

    // その他の失敗はログ記録のみ
    this.logger.error('TranscoderJobFailedPermanent', 'handleFailed', {
      jobId,
      labels,
      errorDescription,
    });
  }

  private isAudioMissingError(
    errorStatus: protos.google.rpc.IStatus | null | undefined,
  ): boolean {
    // AudioMissing エラーの判定文字列
    const AUDIO_MISSING_ERROR = 'AudioMissing';

    if (!errorStatus) return false;

    // まず message をチェック
    if (errorStatus.message?.includes(AUDIO_MISSING_ERROR)) return true;

    // details をまとめて JSON 化して文字列検索
    if (errorStatus.details && errorStatus.details.length > 0) {
      try {
        const serialized = JSON.stringify(errorStatus.details);
        if (serialized.includes(AUDIO_MISSING_ERROR)) {
          return true;
        }
      } catch {
        // stringify に失敗しても無視（判定は false のまま）
      }
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
