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
import { StorageService } from '../../core/storage/storage.service';
import { buildTranscodeRetryClaimPath } from '../../core/storage/storage.utils';
import { MediaProcessingStatus } from '@shared/v1/res';

@Injectable()
export class TranscoderWebhookService {
  private client: TranscoderServiceClient;

  constructor(
    private readonly logger: AppLoggerService,
    private readonly transcoderService: TranscoderService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
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
   *
   * #1599 【バグ】**既にそのステータスなら 1 行も書かない。**
   *
   * Pub/Sub Push は at-least-once 配送で、ハンドラが成功しても応答が届かなければ
   * 同じ通知がもう一度届く。以前は無条件 UPDATE だったので、再配送のたびに
   * `lock_no` が進み、`updated_at` が «何も変わっていないのに» 現在時刻へ動いていた。
   * `updated_at` は «最後に中身が変わった時刻» として読める必要がある。
   *
   * `resize-image.service.ts` の同名メソッドと同じ形にしてある（片方だけ直すと、
   * もう片方で同じ «再配送のたびに行が書き換わる» が残る）。理由の詳細はあちらの
   * doc comment にある。
   */
  private async updateDishMediaProcessingStatus(
    recordId: string,
    status: MediaProcessingStatus,
  ): Promise<void> {
    try {
      const { count } = await this.prisma.prisma.dish_media.updateMany({
        where: { id: recordId, NOT: { media_processing_status: status } },
        data: {
          media_processing_status: status,
          updated_at: new Date(),
          lock_no: { increment: 1 },
        },
      });

      if (count === 0) {
        this.logger.log(
          'DishMediaProcessingStatusUnchanged',
          'updateDishMediaProcessingStatus',
          {
            recordId,
            status,
            reason: 'already_in_status_or_record_missing',
          },
        );
        return;
      }

      this.logger.log(
        'DishMediaProcessingStatusUpdated',
        'updateDishMediaProcessingStatus',
        {
          recordId,
          status,
        },
      );
    } catch (error) {
      this.logger.error(
        'UpdateDishMediaProcessingStatusError',
        'updateDishMediaProcessingStatus',
        {
          recordId,
          status,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      );
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
    if (
      labels?.table_name === 'dish_media' &&
      labels.column_name === 'media_path' &&
      labels.record_id
    ) {
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
    //
    // #1599 【バグ】**再配送のたびにリトライジョブを作り直していた。**
    //
    // Pub/Sub Push は at-least-once 配送で、ハンドラが成功しても応答が届かなければ
    // 同じ FAILED 通知がもう一度届く。判定材料の `labels.retry` は
    // **失敗した «元のジョブ» の label** で、こちらがリトライを作っても変わらない
    // （リトライ側の label に retry=1 が入るだけ）。よって再配送は毎回この分岐へ入り、
    //   - 課金されるトランスコードジョブが何本も走る
    //   - **同じ outputUri へ複数のジョブが同時に書く**（出力が壊れうる）
    // が起きていた。
    //
    // Transcoder の `CreateJobRequest` には job 名を指定する欄が無い
    // （`ICreateJobRequest` は parent と job だけ）ので «同じ id で作れば 1 本» に
    // できない。代わりに **作る前に GCS 上のマーカーを排他生成して権利を取る**。
    // 取れた配送だけがジョブを作る（claim-then-create）。
    const retryCount = parseInt(labels.retry ?? '0', 10);
    if (isAudioMissing && retryCount === 0) {
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

      const claimPath = buildTranscodeRetryClaimPath(outputUri, retryCount + 1);
      const claimed = await this.storage.claimOnce(claimPath, {
        reason: 'transcode_retry_video_only',
        record_id,
        failed_job: jobId,
      });
      if (!claimed) {
        // 既に別の配送がリトライを作っている。ここで «成功として» 抜けるのが正しい
        // （throw すると Pub/Sub が再配送を続け、ログだけが増える）
        this.logger.log('TranscoderJobRetryAlreadyClaimed', 'handleFailed', {
          jobId,
          labels,
          claimPath,
        });
        return;
      }

      try {
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
        // ジョブを作れなかったのに claim を握ったままだと、**再配送でも作り直せず**
        // この動画が永久に processing のまま残る。権利を返してから投げ直す
        await this.storage.deleteFileIfExists(claimPath);

        this.logger.error('TranscoderJobRetryError', 'handleFailed', {
          jobId,
          labels,
          claimPath,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        throw error;
      }

      return;
    }

    // #511 【設計】dish_media テーブルの場合はステータスを failed に更新
    // リトライしない場合のみ更新する。リトライの失敗は別途考慮しない。
    if (table_name === 'dish_media' && column_name === 'media_path') {
      await this.updateDishMediaProcessingStatus(record_id, 'failed');
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
