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
    const recipient = await this.resolveRecipient(targetTable, targetId);
    if (!recipient) {
      throw new Error(
        `RecipientNotFound: Could not resolve recipient for targetTable=${targetTable}, targetId=${targetId}`,
      );
    }

    const recipientId = recipient.user_id;
    // 2-1. 作者なしなら skip
    if (!recipientId) {
      this.logger.debug('RecipientUserNotFound', 'processNotificationJob', {
        recipientId,
      });
      return;
    }
    // 2-2. 自己通知なら skip
    if (recipientId === actorId) {
      this.logger.debug('SelfNotificationSkipped', 'processNotificationJob', {
        recipientId,
      });
      return;
    }

    // 3. トランザクション内で通知を upsert
    const { notificationId, isNew, isUpdated } =
      await this.prisma.withTransaction((tx: Prisma.TransactionClient) =>
        this.repo.upsertNotification(
          tx,
          {
            action_type: actionType,
            target_table: targetTable,
            target_id: targetId,
            idempotency_key: idempotencyKey,
          },
          [recipientId],
          actorId,
        ),
      );

    this.logger.log('NotificationUpserted', 'processNotificationJob', {
      notificationId,
      isNew,
      isUpdated,
      actorId,
      recipientId,
    });

    // 4. Expo Push を送信（新規通知の場合のみ）
    // #通知機能 【設計】既存通知への追加いいね等では Push を送らない
    if (isNew) {
      const { title, body } = this.buildNotificationMessage(
        actionType,
        targetTable,
      );

      await this.service.sendPushNotification(recipientId, {
        title,
        body,
      });
    }
  }

  /**
   * recipient を解決（対象の作者ID）
   */
  private async resolveRecipient(
    targetTable: string,
    targetId: string,
  ): Promise<{ user_id: string | null } | null> {
    if (targetTable === 'dish_media') {
      const media = await this.prisma.prisma.dish_media.findUnique({
        where: { id: targetId },
        select: { user_id: true },
      });
      return media ?? null;
    } else if (targetTable === 'dish_reviews') {
      const review = await this.prisma.prisma.dish_reviews.findUnique({
        where: { id: targetId },
        select: { user_id: true },
      });
      return review ?? null;
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
