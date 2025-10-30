// api/src/v1/notifications/notifications.repository.ts
//
// 🎯 目的
//   • 通知関連の Prisma アクセスを集約
//   • キーセットページング、未読数カウント、カーソル更新を提供
//

import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../shared/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';

export interface NotificationWithRecipient {
  notification_id: string;
  recipient_id: string;
  created_at: Date;
  notification: {
    id: string;
    action_type: string;
    target_table: string;
    target_id: string;
    actor_id: string;
    i18n_key: string;
    i18n_params: any;
    actor_ids: string[];
    actor_count: number;
    idempotency_key: string;
    created_at: Date;
  };
}

@Injectable()
export class NotificationsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * 通知一覧を取得（キーセットページング）
   * @param recipientId 受信者ID
   * @param cursor ページングカーソル（形式: {createdAt}_{notificationId}）
   * @param limit 取得件数
   */
  async findNotificationsByRecipient(
    recipientId: string,
    cursor: string | null,
    limit: number,
  ): Promise<{
    items: NotificationWithRecipient[];
    nextCursor: string | null;
  }> {
    let afterCreatedAt: Date | null = null;
    let afterId: string | null = null;

    if (cursor) {
      const parts = cursor.split('_');
      if (parts.length !== 2) {
        throw new Error(
          'Invalid cursor format. Expected: {createdAt}_{notificationId}',
        );
      }
      afterCreatedAt = new Date(parts[0]);
      if (isNaN(afterCreatedAt.getTime())) {
        throw new Error('Invalid date in cursor');
      }
      afterId = parts[1];
    }

    const where: Prisma.notification_recipientsWhereInput = {
      recipient_id: recipientId,
    };

    // キーセットページング: (created_at, notification_id) < (afterCreatedAt, afterId)
    if (afterCreatedAt && afterId) {
      where.OR = [
        { created_at: { lt: afterCreatedAt } },
        {
          created_at: afterCreatedAt,
          notification_id: { lt: afterId },
        },
      ];
    }

    const items = await this.prisma.prisma.notification_recipients.findMany({
      where,
      orderBy: [{ created_at: 'desc' }, { notification_id: 'desc' }],
      take: limit,
      include: {
        notifications: true,
      },
    });

    // 次ページカーソルを生成
    const last = items[items.length - 1];
    const nextCursor = last
      ? `${last.created_at.toISOString()}_${last.notification_id}`
      : null;

    // 型変換
    const result: NotificationWithRecipient[] = items.map((item) => ({
      notification_id: item.notification_id,
      recipient_id: item.recipient_id,
      created_at: item.created_at,
      notification: {
        id: item.notifications.id,
        action_type: item.notifications.action_type,
        target_table: item.notifications.target_table,
        target_id: item.notifications.target_id,
        actor_id: item.notifications.actor_id,
        i18n_key: item.notifications.i18n_key,
        i18n_params: item.notifications.i18n_params,
        actor_ids: item.notifications.actor_ids,
        actor_count: item.notifications.actor_count,
        idempotency_key: item.notifications.idempotency_key,
        created_at: item.notifications.created_at,
      },
    }));

    return { items: result, nextCursor };
  }

  /**
   * 未読数を取得
   * @param recipientId 受信者ID
   */
  async getUnreadCount(recipientId: string): Promise<number> {
    // user_notification_cursors から last_read_at を取得
    const cursor =
      await this.prisma.prisma.user_notification_cursors.findUnique({
        where: { user_id: recipientId },
      });

    const lastReadAt = cursor?.last_read_at ?? new Date(0); // epoch

    // last_read_at より新しい通知の数をカウント
    const count = await this.prisma.prisma.notification_recipients.count({
      where: {
        recipient_id: recipientId,
        created_at: { gt: lastReadAt },
      },
    });

    return count;
  }

  /**
   * 一括既読（カーソル更新）
   * @param userId ユーザーID
   */
  async markAllAsRead(userId: string): Promise<Date> {
    const now = new Date();

    await this.prisma.prisma.user_notification_cursors.upsert({
      where: { user_id: userId },
      update: { last_read_at: now },
      create: {
        user_id: userId,
        last_read_at: now,
      },
    });

    return now;
  }

  /**
   * デバイストークンを登録/更新
   * @param userId ユーザーID
   * @param expoPushToken Expo Push Token
   */
  async upsertDeviceToken(
    userId: string,
    expoPushToken: string,
  ): Promise<void> {
    await this.prisma.prisma.user_device_tokens.upsert({
      where: {
        user_id_expo_push_token: {
          user_id: userId,
          expo_push_token: expoPushToken,
        },
      },
      update: {
        updated_at: new Date(),
      },
      create: {
        user_id: userId,
        expo_push_token: expoPushToken,
        updated_at: new Date(),
      },
    });
  }

  /**
   * ユーザーの全デバイストークンを取得
   * @param userId ユーザーID
   */
  async findDeviceTokensByUser(userId: string): Promise<string[]> {
    const tokens = await this.prisma.prisma.user_device_tokens.findMany({
      where: { user_id: userId },
      select: { expo_push_token: true },
    });

    return tokens.map((t) => t.expo_push_token);
  }

  /**
   * 失効したデバイストークンを削除
   * @param userId ユーザーID
   * @param expoPushTokens 削除するトークンの配列
   */
  async deleteInvalidTokens(
    userId: string,
    expoPushTokens: string[],
  ): Promise<void> {
    if (expoPushTokens.length === 0) return;

    await this.prisma.prisma.user_device_tokens.deleteMany({
      where: {
        user_id: userId,
        expo_push_token: { in: expoPushTokens },
      },
    });
  }

  /**
   * 通知とrecipientを作成（upsert with aggregation）
   * @param tx トランザクションクライアント
   * @param payload 通知ペイロード
   */
  async upsertNotification(
    tx: Prisma.TransactionClient,
    payload: {
      actionType: 'like' | 'save';
      targetTable: 'dish_media' | 'dish_reviews';
      targetId: string;
      actorId: string;
      recipientId: string;
      idempotencyKey: string;
    },
  ): Promise<{ notificationId: string; isNew: boolean }> {
    const {
      actionType,
      targetTable,
      targetId,
      actorId,
      recipientId,
      idempotencyKey,
    } = payload;

    // i18n キーを決定
    const i18nKey = `notification.${actionType}.${targetTable}`;

    // 既存通知を取得
    const existing = await tx.notifications.findUnique({
      where: { idempotency_key: idempotencyKey },
    });

    let notificationId: string;
    let isNew = false;

    if (existing) {
      // 既存通知を更新（actor集約）
      const newActorIds = Array.from(new Set([...existing.actor_ids, actorId]));

      await tx.notifications.update({
        where: { id: existing.id },
        data: {
          actor_ids: newActorIds,
          actor_count: newActorIds.length,
          i18n_params: {
            actorCount: newActorIds.length,
            targetId,
          },
        },
      });

      notificationId = existing.id;
    } else {
      // 新規通知を作成
      const notification = await tx.notifications.create({
        data: {
          action_type: actionType,
          target_table: targetTable,
          target_id: targetId,
          actor_id: actorId,
          i18n_key: i18nKey,
          i18n_params: {
            actorCount: 1,
            targetId,
          },
          actor_ids: [actorId],
          actor_count: 1,
          idempotency_key: idempotencyKey,
        },
      });

      notificationId = notification.id;
      isNew = true;
    }

    // recipient レコードを追加（on conflict do nothing）
    await tx.notification_recipients.createMany({
      data: [
        {
          notification_id: notificationId,
          recipient_id: recipientId,
        },
      ],
      skipDuplicates: true,
    });

    return { notificationId, isNew };
  }
}
