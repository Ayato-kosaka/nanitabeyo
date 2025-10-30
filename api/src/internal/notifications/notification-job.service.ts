// api/src/internal/notifications/notification-job.service.ts
//
// ❶ Cloud Tasks から通知ジョブを受領し、通知作成＋Expo Push配信を実行
// ❷ 自己通知の skip、idempotency_key での集約、失効トークン削除
//

import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../shared/prisma/client';

import { NotificationJobPayload } from './notification-job.interface';
import { NotificationsRepository } from '../../v1/notifications/notifications.repository';
import { NotificationsService } from '../../v1/notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';

@Injectable()
export class NotificationJobService {
  constructor(
    private readonly repo: NotificationsRepository,
    private readonly service: NotificationsService,
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * 通知ジョブを処理
   */
  async processNotificationJob(payload: NotificationJobPayload): Promise<void> {
    const { actionType, targetTable, targetId, actorId, idempotencyKey } =
      payload;

    this.logger.debug('ProcessingNotificationJob', 'processNotificationJob', {
      actionType,
      targetTable,
      targetId,
      actorId,
      idempotencyKey,
    });

    // 1. recipient を解決（対象の作者ID）
    const recipientId = await this.resolveRecipient(targetTable, targetId);

    if (!recipientId) {
      this.logger.warn('RecipientNotFound', 'processNotificationJob', {
        targetTable,
        targetId,
      });
      return;
    }

    // 2. 自己通知なら skip
    if (recipientId === actorId) {
      this.logger.debug('SelfNotificationSkipped', 'processNotificationJob', {
        actorId,
        recipientId,
      });
      return;
    }

    // 3. トランザクション内で通知を upsert
    const { notificationId, isNew } = await this.prisma.withTransaction(
      (tx: Prisma.TransactionClient) =>
        this.repo.upsertNotification(tx, {
          actionType,
          targetTable,
          targetId,
          actorId,
          recipientId,
          idempotencyKey,
        }),
    );

    this.logger.log('NotificationUpserted', 'processNotificationJob', {
      notificationId,
      isNew,
      actorId,
      recipientId,
    });

    // 4. Expo Push を送信（新規通知の場合のみ）
    if (isNew) {
      const { title, body } = this.buildNotificationMessage(
        actionType,
        targetTable,
      );

      await this.service.sendPushNotification(recipientId, title, body, {
        notificationId,
        actionType,
        targetTable,
        targetId,
      });
    }
  }

  /**
   * recipient を解決（対象の作者ID）
   */
  private async resolveRecipient(
    targetTable: string,
    targetId: string,
  ): Promise<string | null> {
    if (targetTable === 'dish_media') {
      const media = await this.prisma.prisma.dish_media.findUnique({
        where: { id: targetId },
        select: { user_id: true },
      });
      return media?.user_id ?? null;
    } else if (targetTable === 'dish_reviews') {
      const review = await this.prisma.prisma.dish_reviews.findUnique({
        where: { id: targetId },
        select: { user_id: true },
      });
      return review?.user_id ?? null;
    }

    return null;
  }

  /**
   * 通知メッセージを構築
   * #通知機能 【将来対応】i18n 対応（モバイル側で翻訳キーを使用予定）
   */
  private buildNotificationMessage(
    actionType: string,
    targetTable: string,
  ): { title: string; body: string } {
    const NOTIFICATION_MESSAGES = {
      like: {
        dish_media: '料理動画',
        dish_reviews: 'レビュー',
      },
      save: {
        dish_media: '料理動画',
        dish_reviews: 'レビュー',
      },
    };

    const actionText = actionType === 'like' ? 'いいね' : '保存';
    const targetText =
      NOTIFICATION_MESSAGES[actionType as 'like' | 'save']?.[
        targetTable as 'dish_media' | 'dish_reviews'
      ] ?? 'コンテンツ';

    return {
      title: '新しい通知',
      body: `あなたの${targetText}に${actionText}されました`,
    };
  }
}
