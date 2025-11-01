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
import { PrismaNotifications } from '../../../../shared/converters/convert_notifications';
import { PrismaNotificationRecipients } from '../../../../shared/converters/convert_notification_recipients';

@Injectable()
export class NotificationsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) { }

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
    items: (PrismaNotificationRecipients & { 
      notifications: PrismaNotifications;
      actors: Array<{ id: string; display_name: string | null; avatar: string | null }>;
    })[];
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

    // #通知機能 【設計】先頭3件のアクター情報を取得
    const itemsWithActors = await Promise.all(
      items.map(async (item) => {
        const actorIds = item.notifications.actor_ids.slice(0, 3);
        const actors = await this.prisma.prisma.users.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, display_name: true, avatar: true },
        });
        
        // #通知機能 【設計】actor_ids の順序を保持
        const orderedActors = actorIds.map(actorId => 
          actors.find(actor => actor.id === actorId)
        ).filter((actor): actor is { id: string; display_name: string | null; avatar: string | null } => actor !== undefined);

        return {
          ...item,
          actors: orderedActors,
        };
      })
    );

    // 次ページカーソルを生成
    const last = items[items.length - 1];
    const nextCursor = last
      ? `${last.created_at.toISOString()}_${last.notification_id}`
      : null;

    return { items: itemsWithActors, nextCursor };
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
   * @param locale デバイスのロケール（オプション、デフォルト: ja-JP）
   */
  async upsertDeviceToken(
    userId: string,
    expoPushToken: string,
    locale?: string,
  ): Promise<void> {
    // #通知機能 【設計】locale はスキーマ変更後のフィールド。型アサーションで対応。
    await this.prisma.prisma.user_device_tokens.upsert({
      where: {
        user_id_expo_push_token: {
          user_id: userId,
          expo_push_token: expoPushToken,
        },
      },
      update: {
        updated_at: new Date(),
        ...(locale && { locale } as any),
      },
      create: {
        user_id: userId,
        expo_push_token: expoPushToken,
        ...(locale && { locale } as any),
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
   * @param notification 通知ペイロード
   * @param recipientIds 受信者IDの配列
   */
  async upsertNotification(
    tx: Prisma.TransactionClient,
    notification: Omit<PrismaNotifications, 'id' | 'created_at' | 'updated_at' | 'actor_ids'>,
    recipientIds: string[],
    actorId: string,
  ): Promise<{ notificationId: string; isNew: true } | { notificationId: null; isNew: false }> {
    const {
      action_type,
      target_table,
      target_id,
    } = notification;

    let notificationId: string;

    try {
      // #通知機能 【設計】新規通知を作成（actor_ids は actorId のみを含む配列として初期化）
      // スキーマ変更後のフィールドのため型アサーションを使用
      const result = await tx.notifications.create({
        data: {
          ...notification,
          actor_ids: [actorId],
        } as any,
      });
      notificationId = result.id;
    } catch (e: any) {
      // #通知機能 【設計】idempotency_key(${targetTable}:${actionType}:${targetId}) の一意制約違反は、
      // JOB が連打されたか、再いいね の場合なので、後続処理を終了する
      if (e.code === 'P2002') return { notificationId: null, isNew: false }
      // それ以外のエラーは再スロー
      else throw e;
    }
    // recipient レコードを追加（on conflict do nothing）
    await tx.notification_recipients.createMany({
      data: recipientIds.map((recipientId) => ({
        notification_id: notificationId,
        recipient_id: recipientId,
      })),
      skipDuplicates: true,
    });

    return { notificationId, isNew: true };
  }
}
