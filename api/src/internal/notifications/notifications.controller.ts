// api/src/internal/notifications/notifications.controller.ts
//
// ❶ Cloud Tasks からの OIDC 認証済みリクエストのみ受け付ける内部エンドポイント
// ❷ 通知作成＋Expo Push配信を非同期実行
//

import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { NotificationJobPayload } from './notification-job.interface';
import { NotificationJobService } from './notification-job.service';
import { OIDCGuard } from '../oidc.guard';
import { AppLoggerService } from '../../core/logger/logger.service';

/**
 * 内部処理専用コントローラー
 * Cloud Tasks からの OIDC 認証済みリクエストのみ処理
 */
@Controller('internal/notifications')
@UseGuards(OIDCGuard)
export class InternalNotificationsController {
  constructor(
    private readonly notificationJobService: NotificationJobService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * POST /internal/notifications/process
   *
   * Cloud Tasks から呼び出される非同期処理エンドポイント
   * - 通知レコード作成
   * - recipient ひも付け
   * - Expo Push 配信
   */
  @Post('process')
  @HttpCode(HttpStatus.NO_CONTENT)
  async processNotificationJob(
    @Body() payload: NotificationJobPayload,
  ): Promise<void> {
    this.logger.debug('NotificationJobStarted', 'processNotificationJob', {
      actionType: payload.actionType,
      targetTable: payload.targetTable,
      targetId: payload.targetId,
      actorId: payload.actorId,
      idempotencyKey: payload.idempotencyKey,
    });

    try {
      await this.notificationJobService.processNotificationJob(payload);

      this.logger.log('NotificationJobCompleted', 'processNotificationJob', {
        actionType: payload.actionType,
        idempotencyKey: payload.idempotencyKey,
      });
    } catch (error) {
      this.logger.error('NotificationJobError', 'processNotificationJob', {
        actionType: payload.actionType,
        idempotencyKey: payload.idempotencyKey,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // Cloud Tasks のリトライに委譲するため例外を再スロー
      throw error;
    }
  }
}
