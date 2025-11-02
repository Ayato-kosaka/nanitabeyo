// api/src/v1/notifications/notifications.service.ts
//
// ❶ 通知の CRUD、Expo Push 配信を Service で編成
// ❷ チャンク送信（100件/チャンク）と失効トークン削除
//

import { Injectable } from '@nestjs/common';
import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';

import { NotificationsRepository } from './notifications.repository';
import { AppLoggerService } from '../../core/logger/logger.service';
import { QueryNotificationsDto } from '@shared/v1/dto';
import {
  QueryNotificationsResponse,
  MarkAllReadResponse,
  UnreadCountResponse,
  CreateDeviceTokenResponse,
} from '@shared/v1/res';
import { convertPrismaToSupabase_Notifications } from '../../../../shared/converters/convert_notifications';
import { UsersService } from '../users/users.service';
import { DishMediaService } from '../dish-media/dish-media.service';
import { DishMediaMapper } from '../dish-media/dish-media.mapper';

@Injectable()
export class NotificationsService {
  private expo: Expo;

  constructor(
    private readonly repo: NotificationsRepository,
    private readonly logger: AppLoggerService,
    private readonly userService: UsersService,
    private readonly dishMediaService: DishMediaService,
    private readonly dishMediaMapper: DishMediaMapper,
  ) {
    this.expo = new Expo();
  }

  /**
   * GET /v1/notifications - 通知一覧取得
   */
  async getNotifications(userId: string, dto: QueryNotificationsDto) {
    const { cursor, limit = 30 } = dto;

    const { items, nextCursor } = await this.repo.findNotificationsByRecipient(
      userId,
      cursor ?? null,
      limit,
    );

    // actors を一括取得
    const actors = await this.userService.getUserByIds(
      Array.from(
        new Set(items.flatMap((item) => item.notifications.actor_ids)),
      ),
    );
    const actorMap = new Map(actors.map((user) => [user.id, user]));

    // dish_media ターゲットのエンティティを一括取得
    const { items: dishMediaItems, cdnCookies } =
      await this.dishMediaService.fetchDishMediaEntryItems(
        items
          .filter((item) => item.notifications.target_table === 'dish_media')
          .map((item) => item.notifications.target_id),
        { userId },
      );
    const dishMediaEntiries =
      this.dishMediaMapper.toDishMediaEntry(dishMediaItems);
    const dishMediaMap = new Map(
      dishMediaEntiries.map((entry) => [entry.dish_media.id, entry]),
    );

    // #通知機能 【設計】NotificationItem 形式に変換（actors と notification を含む）
    const notificationItems = items.map((item) => ({
      notification: convertPrismaToSupabase_Notifications(item.notifications),
      actors: item.notifications.actor_ids.map(
        (actorId) => actorMap.get(actorId)!,
      ),
      dishMediaEntiries: dishMediaMap.get(item.notifications.target_id),
    }));

    return {
      items: notificationItems,
      nextCursor,
      cdnCookies,
    };
  }

  /**
   * POST /v1/notifications/mark-all-read - 一括既読
   */
  async markAllAsRead(userId: string): Promise<MarkAllReadResponse> {
    const lastReadAt = await this.repo.markAllAsRead(userId);

    return {
      lastReadAt: lastReadAt.toISOString(),
    };
  }

  /**
   * GET /v1/notifications/unread-count - 未読数取得
   */
  async getUnreadCount(userId: string): Promise<UnreadCountResponse> {
    const unread = await this.repo.getUnreadCount(userId);

    return { unread };
  }

  /**
   * POST /v1/device-tokens - デバイストークン登録
   */
  async createDeviceToken(
    userId: string,
    expoPushToken: string,
  ): Promise<CreateDeviceTokenResponse> {
    // トークンの形式を検証（Expo SDK内部でも検証されるが念のため）
    if (!Expo.isExpoPushToken(expoPushToken)) {
      throw new Error('Invalid Expo push token format');
    }

    await this.repo.upsertDeviceToken(userId, expoPushToken);

    this.logger.log('DeviceTokenUpserted', 'createDeviceToken', {
      userId,
      token: expoPushToken.substring(0, 20) + '...',
    });

    return {
      token: expoPushToken,
    };
  }

  /**
   * Expo Push通知を送信（チャンク送信）
   * @param recipientId 受信者ID
   * @param expoPushMessage 通知メッセージ内容
   * @returns void
   */
  async sendPushNotification(
    recipientId: string,
    expoPushMessage: Omit<ExpoPushMessage, 'to'>,
  ): Promise<void> {
    // recipientのデバイストークンを全取得
    const tokens = await this.repo.findDeviceTokensByUser(recipientId);

    if (tokens.length === 0) {
      this.logger.warn('NoPushTokensFound', 'sendPushNotification', {
        recipientId,
      });
      return;
    }

    // 有効なトークンのみフィルタ
    const validTokens = tokens.filter((token) => Expo.isExpoPushToken(token));

    if (validTokens.length === 0) {
      this.logger.warn('NoValidPushTokens', 'sendPushNotification', {
        recipientId,
        totalTokens: tokens.length,
      });
      return;
    }

    // メッセージを作成
    const messages: ExpoPushMessage[] = validTokens.map((token) => ({
      to: token,
      ...expoPushMessage,
    }));

    const invalidTokens: string[] = [];

    // チャンク送信
    for (const chunkMessages of this.expo.chunkPushNotifications(messages)) {
      try {
        const tickets =
          await this.expo.sendPushNotificationsAsync(chunkMessages);

        // エラーチェック
        tickets.forEach((ticket: ExpoPushTicket, index: number) => {
          if (ticket.status === 'error') {
            this.logger.warn('PushNotificationError', 'sendPushNotification', {
              recipientId,
              token: chunkMessages[index].to,
              error: ticket.message,
            });

            // DeviceNotRegistered エラーの場合、トークンを削除リストに追加
            if (
              ticket.details &&
              'error' in ticket.details &&
              ticket.details.error === 'DeviceNotRegistered'
            ) {
              invalidTokens.push(chunkMessages[index].to as string);
            }
          }
        });
      } catch (error) {
        this.logger.error(
          'PushNotificationChunkError',
          'sendPushNotification',
          {
            recipientId,
            chunkSize: chunkMessages.length,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        );
      }
    }

    // 失効トークンを削除
    if (invalidTokens.length > 0) {
      await this.repo.deleteInvalidTokens(recipientId, invalidTokens);
    }

    this.logger.log('PushNotificationsSent', 'sendPushNotification', {
      recipientId,
      totalMessages: messages.length,
      invalidTokens: invalidTokens.length,
    });
  }
}
