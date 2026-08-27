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

@Injectable()
export class NotificationsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * 通知一覧を取得（キーセットページング）
   * @param recipientId 受信者ID
   * @param cursor ページングカーソル（形式: {thread_updated_at}_{notificationId}）
   * @param limit 取得件数
   * #479 【設計】limit+1 方式でページ終端を正確に判定
   */
  async findNotificationsByRecipient(
    recipientId: string,
    cursor: string | null,
    limit: number,
  ): Promise<{
    items: { notifications: PrismaNotifications }[];
    nextCursor: string | null;
  }> {
    let afterThreadUpdatedAt: Date | null = null;
    let afterId: string | null = null;

    if (cursor) {
      const parts = cursor.split('_');
      if (parts.length !== 2) {
        throw new Error(
          'Invalid cursor format. Expected: {thread_updated_at}_{notificationId}',
        );
      }
      afterThreadUpdatedAt = new Date(parts[0]);
      if (isNaN(afterThreadUpdatedAt.getTime())) {
        throw new Error('Invalid date in cursor');
      }
      afterId = parts[1];
    }

    const where: Prisma.notification_recipientsWhereInput = {
      recipient_id: recipientId,
    };

    // #通知機能 【設計】キーセットページング: (thread_updated_at, notification_id) < (afterThreadUpdatedAt, afterId)
    // スキーマ変更後のフィールドのため型アサーションを使用
    if (afterThreadUpdatedAt && afterId) {
      where.OR = [
        { thread_updated_at: { lt: afterThreadUpdatedAt } } as any,
        {
          thread_updated_at: afterThreadUpdatedAt,
          notification_id: { lt: afterId },
        } as any,
      ];
    }

    // #479 【設計】limit+1 件取得して次ページ存在を判定
    const results = await this.prisma.prisma.notification_recipients.findMany({
      where,
      // #通知機能 【設計】thread_updated_at DESC で最新の更新が先頭に来る
      // スキーマ変更後のフィールドのため型アサーションを使用
      orderBy: [
        { thread_updated_at: 'desc' } as any,
        { notification_id: 'desc' },
      ],
      take: limit + 1,
      include: {
        notifications: true,
      },
    });

    // #479 【設計】limit+1 件取得できた場合のみ nextCursor を返す
    const hasMore = results.length > limit;
    const items = hasMore ? results.slice(0, limit) : results;
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last
        ? `${(last as any).thread_updated_at?.toISOString() ?? last.created_at.toISOString()}_${last.notification_id}`
        : null;

    return { items, nextCursor };
  }

  /**
   * 未読数を取得
   * @param recipientId 受信者ID
   * @returns 未読数
   */
  async getUnreadCount(recipientId: string): Promise<number> {
    // user_notification_cursors から last_read_at を取得
    const cursor =
      await this.prisma.prisma.user_notification_cursors.findUnique({
        where: { user_id: recipientId },
      });

    const lastReadAt = cursor?.last_read_at ?? new Date(0); // epoch

    // #通知機能 【設計】thread_updated_at と last_read_at を比較して未読数を算出
    // スキーマ変更後のフィールドのため型アサーションを使用
    const count = await this.prisma.prisma.notification_recipients.count({
      where: {
        recipient_id: recipientId,
        thread_updated_at: { gt: lastReadAt },
      } as any,
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
   * #1506 GRP-04: 投票通知の enrichment 用に、対象セッションの shareToken をまとめて引く。
   * @param sessionIds dish_category_group_vote_sessions.id の配列
   */
  async findGroupVoteSessionsByIds(
    sessionIds: string[],
  ): Promise<{ id: string; share_token: string }[]> {
    if (sessionIds.length === 0) return [];

    return this.prisma.prisma.dish_category_group_vote_sessions.findMany({
      where: { id: { in: sessionIds } },
      select: { id: true, share_token: true },
    });
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
   * @param notification 通知ペイロード
   * @param recipientIds 受信者IDの配列
   * @param actorId アクターID
   * @returns 通知ID（新規作成時）または null（既存通知更新時）
   */
  async upsertNotification(
    tx: Prisma.TransactionClient,
    notification: Omit<
      PrismaNotifications,
      'id' | 'created_at' | 'updated_at' | 'actor_ids'
    >,
    recipientIds: string[],
    actorId: string,
  ): Promise<{ notificationId: string; isNew: boolean }> {
    const { idempotency_key } = notification;

    // #通知機能 【設計】既存通知を検索
    const existing = await tx.notifications.findUnique({
      where: { idempotency_key },
      select: { id: true, actor_ids: true },
    });

    async function updateExistingNotification(
      id: string,
      currentActorIds: string[],
      actorId: string,
    ) {
      // #通知機能 【設計】既存通知の場合、actor_ids を更新
      // 1. actorId が既に存在する場合は先頭に移動
      // 2. 存在しない場合は先頭に追加
      // 3. 配列の長さを3に制限
      const newActorIds = [
        actorId,
        ...currentActorIds.filter((id) => id !== actorId),
      ].slice(0, 3);

      // #通知機能 【設計】updated_at と thread_updated_at を更新
      const now = new Date();
      await tx.notifications.update({
        where: { id },
        data: {
          actor_ids: newActorIds,
          updated_at: now,
        },
      });

      // notification_recipients の thread_updated_at を更新
      await tx.notification_recipients.updateMany({
        where: { notification_id: id },
        data: {
          thread_updated_at: now,
        },
      });
    }

    if (existing) {
      await updateExistingNotification(
        existing.id,
        existing.actor_ids,
        actorId,
      );
      return { notificationId: existing.id, isNew: false };
    }

    // #通知機能 【設計】新規通知を作成
    let createdNotification: PrismaNotifications;
    try {
      createdNotification = await tx.notifications.create({
        data: {
          ...notification,
          actor_ids: [actorId],
        },
      });
    } catch (e: any) {
      // #通知機能 【設計】稀にレースコンディションで重複が発生した場合は再試行せず終了
      if (e.code === 'P2002') {
        this.logger.warn('NotificationRaceCondition', 'upsertNotification', {
          idempotency_key,
          actorId,
        });
        // 既存通知を取得して更新
        const retry = await tx.notifications.findUnique({
          where: { idempotency_key },
          select: { id: true, actor_ids: true },
        });
        if (retry) {
          await updateExistingNotification(retry.id, retry.actor_ids, actorId);
          return { notificationId: retry.id, isNew: false };
        }
        throw e;
      }
      throw e;
    }

    // recipient レコードを追加（on conflict do nothing）
    await tx.notification_recipients.createMany({
      data: recipientIds.map((recipientId) => ({
        notification_id: createdNotification.id,
        recipient_id: recipientId,
        thread_updated_at: createdNotification.updated_at,
      })),
      skipDuplicates: true,
    });

    return { notificationId: createdNotification.id, isNew: true };
  }

  /**
   * #1599 **この受取人へ «この actor 分の Push» を送る権利を 1 回だけ取る。**
   *
   * Cloud Tasks は at-least-once 配送で、**ハンドラが成功したのに応答が届かなかった
   * 場合も再実行される**。`upsertNotification` は `idempotency_key` で冪等なので
   * «通知行» は二重にならないが、その後の `sendPushNotification` は無条件に走るため、
   * **同じ Push がユーザーへ 2 回届く**。行の冪等性と配信の冪等性は別の話である。
   *
   * ## なぜ「新規作成のときだけ送る」では駄目なのか
   * `upsertNotification` の戻り値 `isNew` で分岐すると、**同じ投稿への 2 人目以降の
   * いいね通知が丸ごと消える**。`idempotency_key` は
   * (action_type, target_table, target_id) 単位で共有され、2 人目は
   * «既存通知の actor_ids を更新» する経路（isNew: false）に入るためである。
   * 区別すべきは «再配送» と «正当な追加イベント» であって、«新規» と «既存» ではない。
   *
   * ## なぜ既存の列では判別できないのか
   * - `actor_ids` … 先頭 3 件までの MRU リスト。同じ actor の再配送では中身が変わらず、
   *   上限 3 に張り付くと 4 人目以降は件数も変わらない
   * - `thread_updated_at` … 再配送でも毎回 `now()` で更新されるので時刻比較も使えない
   *
   * したがって «誰の分まで送ったか» を持つ列（`last_pushed_actor_id`）を足した
   * （`20260826T0400_add_notification_recipients_last_pushed.sql`）。
   *
   * ## 「送ってから記録する」ではなく「記録できたら送る」
   * 1 文の条件付き UPDATE なので、再配送が同時に 2 本届いても片方しか通らない。
   * 逆順（送ってから記録）にすると、記録の前に落ちた場合にもう一度送ってしまう。
   *
   * ⚠️ Prisma の `updateMany` では書けない。`last_pushed_actor_id` は NULL 許容で、
   * **まだ一度も送っていない行（NULL）も «この actor とは違う» として拾う**必要がある。
   * SQL の `<>` は NULL を落とす（`NULL <> x` は NULL = 偽扱い）ので、
   * それだと **1 回目の Push が誰にも届かない**。`IS DISTINCT FROM` でなければならない。
   * PostgreSQL 16 で ①NULL→A=1 ②Aの再配送=0 ③B=1 ④Bの再配送=0、および
   * `<>` では NULL 行が 0 件・`IS DISTINCT FROM` では 1 件になることを実測して確認した。
   *
   * ## 残る穴（承知のうえ）
   * 持っているのは «最後の 1 件» なので、**A → B → A の再配送**という順に届くと
   * A の分がもう一度送られる（最後が B になっているため）。守りたいのは
   * «同じタスクの直後の再配送» であり、その間に別の actor のジョブが完了する必要がある
   * この順序は稀である。ここを塞ぐには actor ごとに 1 行持つ（＝別テーブル）ことになり、
   * 得られるものに対して重い。migration のヘッダにも同じ判断を書いてある。
   *
   * @returns true = 自分が取れた（送ってよい）/ false = 既にこの actor 分は送信済み
   */
  async claimPushDelivery(
    notificationId: string,
    recipientId: string,
    actorId: string,
  ): Promise<boolean> {
    // withTransaction を通すのは search_path（DB_SCHEMA）を確実に効かせるため。
    // 素の $executeRaw は接続既定のスキーマ解決に依存する
    const updated = await this.prisma.withTransaction(
      (tx) =>
        tx.$executeRaw`
        UPDATE notification_recipients
           SET last_pushed_actor_id = ${actorId}::uuid,
               last_pushed_at       = now()
         WHERE notification_id = ${notificationId}::uuid
           AND recipient_id    = ${recipientId}::uuid
           AND last_pushed_actor_id IS DISTINCT FROM ${actorId}::uuid
      `,
    );

    if (updated === 0) {
      this.logger.log('PushDeliveryAlreadyClaimed', 'claimPushDelivery', {
        notificationId,
        recipientId,
        actorId,
      });
      return false;
    }

    return true;
  }

  /* ------------------------------------------------------------------ */
  /*        #1510 SET-02 通知カテゴリ別の受信設定                        */
  /* ------------------------------------------------------------------ */

  /**
   * ユーザーの受信設定を全件取得（#1510）
   *
   * **行が無いカテゴリは返らない。** 「未設定 = 既定値」の解決は Service 側で行う。
   * ここで既定値を埋めてしまうと「保存済みか未設定か」の情報が失われ、
   * 将来 既定値を変えたときに保存済みの値と区別できなくなる。
   */
  async findNotificationPreferences(
    userId: string,
  ): Promise<{ category: string; enabled: boolean }[]> {
    return this.prisma.prisma.user_notification_preferences.findMany({
      where: { user_id: userId },
      select: { category: true, enabled: true },
    });
  }

  /**
   * 単一カテゴリの受信設定を取得（#1510）
   *
   * @returns 保存済みなら `enabled` の値、**未設定なら `null`**（既定値の解決は呼び出し側）
   */
  async findNotificationPreference(
    userId: string,
    category: string,
  ): Promise<boolean | null> {
    const row =
      await this.prisma.prisma.user_notification_preferences.findUnique({
        where: {
          user_id_category: { user_id: userId, category },
        },
        select: { enabled: true },
      });

    return row?.enabled ?? null;
  }

  /**
   * 受信設定を upsert（#1510）
   *
   * 既定値と同じ値でも行を作る。「明示的にその値を選んだ」ことを残しておくと、
   * 将来カテゴリの既定値を変更したときに、選択済みのユーザーを巻き込まずに済む。
   */
  async upsertNotificationPreference(
    userId: string,
    category: string,
    enabled: boolean,
  ): Promise<void> {
    await this.prisma.prisma.user_notification_preferences.upsert({
      where: {
        user_id_category: { user_id: userId, category },
      },
      create: { user_id: userId, category, enabled },
      update: { enabled, updated_at: new Date() },
    });

    this.logger.debug(
      'NotificationPreferenceUpserted',
      'upsertNotificationPreference',
      { userId, category, enabled },
    );
  }
}
