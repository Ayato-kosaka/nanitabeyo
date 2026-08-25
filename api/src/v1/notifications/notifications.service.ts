// api/src/v1/notifications/notifications.service.ts
//
// ❶ 通知の CRUD、Expo Push 配信を Service で編成
// ❷ チャンク送信（100件/チャンク）と失効トークン削除
//

import { BadRequestException, Injectable } from '@nestjs/common';
import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';

import { NotificationsRepository } from './notifications.repository';
import { AppLoggerService } from '../../core/logger/logger.service';
import { QueryNotificationsDto } from '@shared/v1/dto';
import {
  MarkAllReadResponse,
  UnreadCountResponse,
  CreateDeviceTokenResponse,
  NotificationResponse,
  DishMediaEntry,
  QueryMeNotificationPreferencesResponse,
  UpdateMeNotificationPreferenceResponse,
} from '@shared/v1/res';
import {
  getNotificationCategoryDefault,
  isNotificationCategory,
  resolveNotificationCategory,
  NOTIFICATION_CATEGORY_DEFINITIONS,
  type NotificationCategory,
  type NotificationKind,
} from '@shared/v1/constants/notificationCategories';
import {
  convertPrismaToSupabase_Notifications,
  PrismaNotifications,
} from '../../../../shared/converters/convert_notifications';
import { UsersService } from '../users/users.service';
import { DishMediaService } from '../dish-media/dish-media.service';
import { UsersAssembler } from '../users/users.assembler';
import { DishMediaRepository } from '../dish-media/dish-media.repository';
import { convertPrismaToSupabase_DishReviews } from '../../../../shared/converters/convert_dish_reviews';
import { toNullableId } from '../../core/utils/backend-utils';

@Injectable()
export class NotificationsService {
  private expo: Expo;

  constructor(
    private readonly repo: NotificationsRepository,
    private readonly logger: AppLoggerService,
    private readonly userService: UsersService,
    private readonly usersAssembler: UsersAssembler,
    private readonly dishMediaService: DishMediaService,
    private readonly dishMediaRepo: DishMediaRepository,
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
    const actorEntries = actors.map((user) =>
      this.usersAssembler.enrichUserProfileWithAvatarUrls(user),
    );
    const actorMap = new Map(
      actorEntries.map(({ id, display_name, avatarUrls }) => [
        id,
        { id, display_name, avatarUrls },
      ]),
    );

    const { items: reviews } = await this.dishMediaRepo.findDishReviewsByUser(
      userId,
      {
        type: 'ids',
        ids: items
          .filter((item) => item.notifications.target_table === 'dish_reviews')
          .map((item) => item.notifications.target_id),
      },
    );
    const reviewMap = new Map(
      reviews.map((r) => [
        r.id,
        { ...r, ...convertPrismaToSupabase_DishReviews(r) },
      ]),
    );

    // dish_media ターゲットのエンティティを一括取得
    const uniqueDishMediaIds = Array.from(
      new Set([
        ...items
          .filter((item) => item.notifications.target_table === 'dish_media')
          .map((item) => item.notifications.target_id),
        // #1395 写真なしの「食べた」記録では created_dish_media_id が NULL になる。
        // 落としておかないと dish_media.findMany({ where: { id: { in: [null] } } }) になる
        ...reviews
          .map((review) => toNullableId(review.created_dish_media_id))
          .filter((id): id is string => id !== null),
      ]),
    );
    const { items: dishMediaItems } =
      await this.dishMediaService.fetchDishMediaEntryItems(uniqueDishMediaIds, {
        userId,
        // #1513 墓標「削除されました」を出す画面。行を消さずに中身だけ差し替えるため、
        // 削除済みの dish_media も受け取る（詳細は getDishMediaEntriesByIds の JSDoc）
        includeDeleted: true,
      });
    const dishMediaMap = new Map(
      dishMediaItems.map((entry) => [entry.dish_media.id, entry]),
    );

    // #1506 GRP-04: dish_category_group_vote_sessions ターゲットの shareToken を一括取得
    // （通知タップ時に結果画面 `[shareToken]` へ遷移するため、内部 session id とは別に必要）
    const groupVoteSessions = await this.repo.findGroupVoteSessionsByIds(
      Array.from(
        new Set(
          items
            .filter(
              (item) =>
                item.notifications.target_table ===
                'dish_category_group_vote_sessions',
            )
            .map((item) => item.notifications.target_id),
        ),
      ),
    );
    const groupVoteSessionMap = new Map(
      groupVoteSessions.map((session) => [session.id, session]),
    );

    // #通知機能 【設計】NotificationItem 形式に変換（actors と notification を含む）
    const notificationItems = items.map((item) => ({
      notification: convertPrismaToSupabase_Notifications(
        item.notifications,
      ) as NotificationResponse,
      actors: item.notifications.actor_ids
        .map((actorId) => actorMap.get(actorId))
        .filter((actor) => actor !== undefined),
      dishMediaEntries:
        item.notifications.target_table === 'dish_media'
          ? dishMediaMap.get(item.notifications.target_id)
          : item.notifications.target_table === 'dish_reviews'
            ? this.buildDishMediaEntryForReviewNotification(
                item,
                reviewMap,
                dishMediaMap,
              )
            : undefined,
      dishCategoryGroupVoteSession:
        item.notifications.target_table ===
        'dish_category_group_vote_sessions'
          ? (() => {
              const session = groupVoteSessionMap.get(
                item.notifications.target_id,
              );
              return session
                ? { id: session.id, shareToken: session.share_token }
                : undefined;
            })()
          : undefined,
    }));

    return {
      items: notificationItems,
      nextCursor,
    };
  }

  private buildDishMediaEntryForReviewNotification(
    item: { notifications: PrismaNotifications },
    reviewMap: Map<string, DishMediaEntry['dish_reviews'][number]>,
    dishMediaMap: Map<string, DishMediaEntry>,
  ) {
    const review = reviewMap.get(item.notifications.target_id);
    if (!review) return undefined;

    // #1395 写真なしレビューへのいいね通知では紐づくメディアが無い。
    // 通知自体は残り、サムネイルだけが出ない（フロントはサムネイル欠落を許容すること）
    const mediaId = toNullableId(review.created_dish_media_id);
    const dishME = mediaId === null ? undefined : dishMediaMap.get(mediaId);
    if (!dishME) return undefined;

    return {
      ...dishME,
      dish_reviews: [
        review,
        ...dishME.dish_reviews.filter((dr) => dr.id !== review.id),
      ],
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

  /* ------------------------------------------------------------------ */
  /*        #1510 SET-02 通知カテゴリ別の受信設定                        */
  /* ------------------------------------------------------------------ */

  /**
   * GET /v1/users/me/notification-preferences（#1510）
   *
   * 全カテゴリを `NOTIFICATION_CATEGORIES` の並び順で返す。
   * 行が無いカテゴリは `defaultEnabled` で埋めるので、クライアントは
   * 「未設定」という状態を知らなくてよい（既定値ロジックをサーバーに寄せる）。
   */
  async getMyNotificationPreferences(
    userId: string,
  ): Promise<QueryMeNotificationPreferencesResponse> {
    const rows = await this.repo.findNotificationPreferences(userId);
    const savedByCategory = new Map(
      rows.map((row) => [row.category, row.enabled]),
    );

    const data = NOTIFICATION_CATEGORY_DEFINITIONS.map((definition) => ({
      category: definition.category,
      enabled:
        savedByCategory.get(definition.category) ?? definition.defaultEnabled,
    }));

    this.logger.debug(
      'GetMyNotificationPreferences',
      'getMyNotificationPreferences',
      { userId, savedCount: rows.length },
    );

    return { data };
  }

  /**
   * PATCH /v1/users/me/notification-preferences/{category}（#1510）
   *
   * カテゴリの妥当性は DTO（`@IsIn(NOTIFICATION_CATEGORIES)`）で弾いているが、
   * DB 側に CHECK が無いぶんここでも確認する。未知のカテゴリで行を作ってしまうと
   * 設定画面からは二度と触れない幽霊行になるため。
   */
  async updateMyNotificationPreference(
    userId: string,
    category: string,
    enabled: boolean,
  ): Promise<UpdateMeNotificationPreferenceResponse> {
    if (!isNotificationCategory(category)) {
      throw new BadRequestException(`UnknownNotificationCategory: ${category}`);
    }

    await this.repo.upsertNotificationPreference(userId, category, enabled);

    this.logger.log(
      'NotificationPreferenceUpdated',
      'updateMyNotificationPreference',
      { userId, category, enabled },
    );

    return { category, enabled };
  }

  /**
   * 通知種別（target_table × action_type）のプッシュ配信が許可されているか（#1510）
   *
   * 配信直前（`notification-job.service.ts` の upsert 後・push 前）で呼ばれる。
   *
   * - 対応表に無い組は **許可**（true）。新種別の登録漏れで通知が黙って消えるより、
   *   届いてしまうほうが被害が小さいという判断（設計コメント参照）
   * - 行が無いカテゴリは `defaultEnabled`（現行は全カテゴリ true = 現行挙動と同一）
   * - 読み取りに失敗した場合は例外をそのまま投げ、Cloud Tasks のリトライに乗せる
   *   （`idempotency_key` があるので再実行しても通知が二重にならない）
   */
  async isPushAllowedForKind(
    recipientId: string,
    kind: NotificationKind,
  ): Promise<{ allowed: boolean; category: NotificationCategory | null }> {
    const category = resolveNotificationCategory(kind);

    if (!category) {
      this.logger.warn(
        'NotificationCategoryUnmapped',
        'isPushAllowedForKind',
        // 対応表への追加漏れを検知するためのログ。件数が増えたら shared の定義を直す
        { recipientId, ...kind },
      );
      return { allowed: true, category: null };
    }

    const saved = await this.repo.findNotificationPreference(
      recipientId,
      category,
    );

    return {
      allowed: saved ?? getNotificationCategoryDefault(category),
      category,
    };
  }
}
