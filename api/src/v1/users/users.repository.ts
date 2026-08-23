// api/src/v1/users/users.repository.ts
//
// Repository for users data access
//

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../core/logger/logger.service';
import { PrismaUsers } from '../../../../shared/converters/convert_users';

@Injectable()
export class UsersRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * ユーザーの収益一覧を取得
   */
  async findUserPayouts(
    userId: string,
    cursor?: string,
    limit = 42,
  ): Promise<{
    items: Awaited<
      ReturnType<typeof this.prisma.prisma.payouts.findMany>
    >[number][];
    nextCursor: string | null;
  }> {
    this.logger.debug('FindUserPayouts', 'findUserPayouts', {
      userId,
      cursor,
      limit,
    });

    const whereClause: any = {
      user_id: userId,
    };

    if (cursor) {
      whereClause.created_at = {
        lt: new Date(cursor),
      };
    }

    const result = await this.prisma.prisma.payouts.findMany({
      where: whereClause,
      orderBy: {
        created_at: 'desc',
      },
      take: limit + 1,
    });

    // #479 【設計】limit+1 件取得できた場合のみ nextCursor を返す
    const hasMore = result.length > limit;
    const items = hasMore ? result.slice(0, limit) : result;
    const nextCursor =
      hasMore && items.length > 0
        ? items[items.length - 1].created_at.toISOString()
        : null;

    this.logger.debug('UserPayoutsFound', 'findUserPayouts', {
      count: items.length,
      hasMore,
    });

    return { items, nextCursor };
  }

  /**
   * ユーザーの入札履歴を取得
   */
  async findUserRestaurantBids(
    userId: string,
    cursor?: string,
    limit = 42,
  ): Promise<{
    items: Awaited<
      ReturnType<typeof this.prisma.prisma.restaurant_bids.findMany>
    >[number][];
    nextCursor: string | null;
  }> {
    this.logger.debug('FindUserRestaurantBids', 'findUserRestaurantBids', {
      userId,
      cursor,
      limit,
    });

    const whereClause: any = {
      user_id: userId,
    };

    if (cursor) {
      whereClause.created_at = {
        lt: new Date(cursor),
      };
    }

    const result = await this.prisma.prisma.restaurant_bids.findMany({
      where: whereClause,
      orderBy: {
        created_at: 'desc',
      },
      take: limit + 1,
    });

    // #479 【設計】limit+1 件取得できた場合のみ nextCursor を返す
    const hasMore = result.length > limit;
    const items = hasMore ? result.slice(0, limit) : result;
    const nextCursor =
      hasMore && items.length > 0
        ? items[items.length - 1].created_at.toISOString()
        : null;

    this.logger.debug('UserRestaurantBidsFound', 'findUserRestaurantBids', {
      count: items.length,
      hasMore,
    });

    return { items, nextCursor };
  }

  /**
   * 指定されたIDのユーザーを取得
   *
   * #1511 削除済み（deleted_at IS NOT NULL）のユーザーは返さない。
   * 通知の actor 表示・push 文面の組み立てがここを通るため、
   * 退会したユーザーの表示名が他人の画面に出続けるのを構造的に塞ぐ。
   * 呼び出し側は「引けない actor がありうる」前提で書くこと。
   */
  async getUserByIds(userId: string[]) {
    return this.prisma.prisma.users.findMany({
      where: {
        id: { in: userId },
        deleted_at: null,
      },
    });
  }

  /**
   * 指定されたIDのユーザーを1件取得
   *
   * #1511 削除済みユーザーは「存在しない」として null を返す
   * （`findUnique` では複合条件を書けないため `findFirst` を使う）。
   * これにより `GET /v1/users/:id` は退会後 404 になり、
   * `POST /v1/users/me` の前段チェックも同時に塞がる。
   */
  async getUserById(userId: string) {
    return this.prisma.prisma.users.findFirst({
      where: { id: userId, deleted_at: null },
    });
  }

  /**
   * #1511 削除処理のためだけの取得。**deleted_at を無視して**行を引く。
   *
   * 削除は冪等でなければならない（DB の匿名化まで済んで auth 削除で落ちた、という
   * 状態から再実行で完了できること）。`getUserById` は削除済みを隠すので、
   * 再実行時に「ユーザーが居ない」と誤判定してしまう。ここだけは素の行を見る。
   */
  async getUserByIdIncludingDeleted(userId: string) {
    return this.prisma.prisma.users.findUnique({
      where: { id: userId },
    });
  }

  /**
   * ユーザープロフィールを更新
   */
  async updateUserProfile(
    data: Partial<Omit<PrismaUsers, 'created_at' | 'updated_at' | 'lock_no'>>,
  ) {
    const result = await this.prisma.prisma.users.update({
      where: { id: data.id },
      data: {
        ...data,
        updated_at: new Date(),
        lock_no: { increment: 1 },
      },
    });
    return result;
  }

  /**
   * ブロック中の料理カテゴリを取得
   */
  async findBlockedDishCategories(
    userId: string,
    cursor?: string,
    limit = 42,
  ): Promise<{
    items: string[]; // dish_categories IDs
    nextCursor: string | null;
  }> {
    this.logger.debug(
      'FindBlockedDishCategories',
      'findBlockedDishCategories',
      {
        userId,
        cursor,
        limit,
      },
    );

    const whereClause: any = {
      user_id: userId,
      target_type: 'dish_categories',
      action_type: 'block',
    };

    if (cursor) {
      whereClause.created_at = {
        lt: new Date(cursor),
      };
    }

    const result = await this.prisma.prisma.reactions.findMany({
      where: whereClause,
      orderBy: {
        created_at: 'desc',
      },
      take: limit + 1,
      select: {
        target_id: true,
        created_at: true,
      },
    });

    const hasMore = result.length > limit;
    const items = hasMore ? result.slice(0, limit) : result;
    const nextCursor =
      hasMore && items.length > 0
        ? items[items.length - 1].created_at.toISOString()
        : null;

    this.logger.debug(
      'BlockedDishCategoriesFound',
      'findBlockedDishCategories',
      {
        count: items.length,
        hasMore,
      },
    );

    return { items: items.map((r) => r.target_id), nextCursor };
  }

  /**
   * 料理カテゴリのブロックを解除
   */
  async unblockDishCategory(
    userId: string,
    categoryId: string,
  ): Promise<boolean> {
    this.logger.debug('UnblockDishCategory', 'unblockDishCategory', {
      userId,
      categoryId,
    });

    const result = await this.prisma.prisma.reactions.deleteMany({
      where: {
        user_id: userId,
        target_type: 'dish_categories',
        target_id: categoryId,
        action_type: 'block',
      },
    });

    this.logger.debug('UnblockDishCategoryResult', 'unblockDishCategory', {
      count: result.count,
    });

    return result.count > 0;
  }

  /* ------------------------------------------------------------------ */
  /*                    DELETE /v1/users/me（#1511）                    */
  /* ------------------------------------------------------------------ */
  /**
   * アカウント削除のアプリ DB 側を **1 トランザクション**で行う。
   *
   * ## ここでやること（リーダー判断 #1511 の表に対応）
   * 1. `users` 行を残したまま PII を匿名化し `deleted_at` を立てる
   *    - `username` は citext unique なので `deleted_<id>` へ置換して名前を解放する
   *    - `display_name` / `bio` / `avatar_path` を NULL 化する
   * 2. 本人の行動そのもの（いいね・リアクション・端末トークン・既読位置・権限・受信箱）を物理削除
   * 3. 2 で消したいいねの分だけ `dish_media_analysis_results.like_total` を **実数で引き直す**
   *
   * ## ここでやらないこと
   * - `dish_media` / `dish_reviews` は **行も user_id も触らない**。
   *   投稿・レビューの論理削除は「作者の `users.deleted_at`」で表現し、読み取り経路が
   *   `users` を準結合して落とす（dish-media.repository.ts）。user_id を NULL にすると
   *   作者を辿れなくなり、この判定自体ができなくなる。
   * - `restaurant_bids` / `payouts` は金銭記録なので保持する。
   * - 行動ログ（`*_event_logs` / impressions / views）は保持する（BigQuery にも複製があり、
   *   アプリ DB だけ消しても「消えた」ことにならない。保持する旨をプライバシーポリシーに明記した）。
   *
   * ## 冪等性
   * すべて `updateMany` / `deleteMany` と「現在値の再計算」で書いており、
   * 2 回目以降の実行は 0 件更新になるだけで壊れない。`username` の置換先は id から
   * 決まるので、再実行しても同じ値に落ち着く。
   *
   * @returns 匿名化・削除した件数の内訳（監査ログ用）
   */
  async softDeleteUserAccount(userId: string): Promise<{
    deletedAt: Date;
    likesDeleted: number;
    reactionsDeleted: number;
    deviceTokensDeleted: number;
    notificationCursorsDeleted: number;
    notificationRecipientsDeleted: number;
    rolesDeleted: number;
    likeTotalsRecalculated: number;
  }> {
    this.logger.debug('SoftDeleteUserAccount', 'softDeleteUserAccount', {
      userId,
    });

    return this.prisma.withTransaction(async (tx) => {
      const deletedAt = new Date();

      // ── 1. いいねを消す前に、影響を受ける dish_media を控える ──────────
      // 先に消してしまうと「どの投稿の like_total を引き直すか」が分からなくなる
      const affectedLikes = await tx.dish_media_likes.findMany({
        where: { user_id: userId },
        select: { dish_media_id: true },
      });
      const affectedDishMediaIds = Array.from(
        new Set(affectedLikes.map((l) => l.dish_media_id)),
      );

      const likes = await tx.dish_media_likes.deleteMany({
        where: { user_id: userId },
      });

      // ── 2. 本人の行動データを物理削除する ─────────────────────────
      // reactions は「保存 / ブロック / いいね」等の個人の嗜好そのもの。
      // ⚠️ 他人のリアクションには触らない（`user_id = 本人` で必ず絞る）
      const reactions = await tx.reactions.deleteMany({
        where: { user_id: userId },
      });
      // プッシュ通知を確実に止める
      const deviceTokens = await tx.user_device_tokens.deleteMany({
        where: { user_id: userId },
      });
      const notificationCursors = await tx.user_notification_cursors.deleteMany(
        { where: { user_id: userId } },
      );
      // 本人の受信箱。notifications 本体（他人にも配られている）は消さない
      const notificationRecipients = await tx.notification_recipients.deleteMany(
        { where: { recipient_id: userId } },
      );
      // 権限の剥奪（PermissionGuard は user_roles を見る）
      const roles = await tx.user_roles.deleteMany({
        where: { user_id: userId },
      });

      // ── 3. like_total を実数で引き直す ───────────────────────────
      // #1511 いいねを物理削除すると集計のトゥルース源 `like_total` とズレる。
      // 減算（`decrement`）ではなく **現在の実数を数え直す**のは、削除処理が
      // 再実行されても二重に引かれないようにするため（冪等性）。
      let likeTotalsRecalculated = 0;
      for (const dishMediaId of affectedDishMediaIds) {
        const remaining = await tx.dish_media_likes.count({
          where: { dish_media_id: dishMediaId },
        });
        const updated = await tx.dish_media_analysis_results.updateMany({
          where: { dish_media_id: dishMediaId },
          data: { like_total: remaining, updated_at: new Date() },
        });
        likeTotalsRecalculated += updated.count;
      }

      // ── 4. users 行の匿名化 + deleted_at ────────────────────────
      // ⚠️ `updateMany` にしているのは冪等性のため。既に削除済みでも 0 件更新で通る。
      await tx.users.updateMany({
        where: { id: userId },
        data: {
          username: `deleted_${userId}`,
          display_name: null,
          bio: null,
          avatar_path: null,
          deleted_at: deletedAt,
          updated_at: deletedAt,
          lock_no: { increment: 1 },
        },
      });

      this.logger.log('SoftDeleteUserAccountDone', 'softDeleteUserAccount', {
        userId,
        likesDeleted: likes.count,
        reactionsDeleted: reactions.count,
        deviceTokensDeleted: deviceTokens.count,
        notificationCursorsDeleted: notificationCursors.count,
        notificationRecipientsDeleted: notificationRecipients.count,
        rolesDeleted: roles.count,
        likeTotalsRecalculated,
      });

      return {
        deletedAt,
        likesDeleted: likes.count,
        reactionsDeleted: reactions.count,
        deviceTokensDeleted: deviceTokens.count,
        notificationCursorsDeleted: notificationCursors.count,
        notificationRecipientsDeleted: notificationRecipients.count,
        rolesDeleted: roles.count,
        likeTotalsRecalculated,
      };
    });
  }

  /**
   * #1511 削除対象ユーザーが投稿した dish_media のメディアパスを引く。
   *
   * GCS の実体を消すために使う。**論理削除なので行は残す**が、
   * 「参照が消えたあとに実体を残す理由がない」（リーダー判断）ため、
   * 画像・動画のオブジェクトは削除する。
   */
  async findDishMediaPathsByUser(userId: string) {
    return this.prisma.prisma.dish_media.findMany({
      where: { user_id: userId },
      select: { id: true, media_path: true, thumbnail_path: true },
    });
  }
}
