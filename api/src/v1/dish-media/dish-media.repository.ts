// api/src/modules/dish-media/dish-media.repository.ts
//
// 🎯 目的
//   • Prisma を “1 つのデータ取得 API” として隠蔽し、Service から直アクセスさせない
//   • 地理検索 / 重複チェック / トランザクション更新 を 1 箇所に集約
//   • 返却は **ドメイン Entity** に近い形（型安全 & Service で再集計不要）
//

import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../shared/prisma/client';
import { PrismaRestaurants } from '../../../../shared/converters/convert_restaurants';
import { PrismaDishes } from '../../../../shared/converters/convert_dishes';
import { PrismaDishMedia } from '../../../../shared/converters/convert_dish_media';
import { PrismaDishReviews } from '../../../../shared/converters/convert_dish_reviews';
import { AppLoggerService } from 'src/core/logger/logger.service';

import {
  CreateDishMediaDto,
  SearchDishMediaDto,
  LikeDishMediaParamsDto,
  SaveDishMediaParamsDto,
  QueryRestaurantDishMediaDto,
} from '@shared/v1/dto';

import { PrismaService } from '../../prisma/prisma.service';

/* -------------------------------------------------------------------------- */
/*                       返却型 (ドメイン Entity 例)                           */
/* -------------------------------------------------------------------------- */
export interface DishMediaEntryEntity {
  restaurant: PrismaRestaurants;
  dish: PrismaDishes & {
    reviewCount: number;
    averageRating: number;
  };
  dish_media: PrismaDishMedia & {
    isSaved: boolean;
    isLiked: boolean;
    likeCount: number;
  };
  dish_reviews: (PrismaDishReviews & {
    username: string;
    isLiked: boolean;
    likeCount: number;
  })[];
}

@Injectable()
export class DishMediaRepository {
  private readonly reactionKey = (type: string, id: string, action: string) =>
    `${type}:${id}:${action}`;
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) { }

  /* ------------------------------------------------------------------ */
  /*   料理メディアを位置 + カテゴリ + 未閲覧 で取得（返却数固定）    */
  /* ------------------------------------------------------------------ */
  async findDishMediaIds(
    {
      location,
      radius,
      categoryId,
      limit = 42,
      cursor,
      sort = '-createdAt',
    }: SearchDishMediaDto,
    viewerId?: string,
  ): Promise<string[]> {
    // Haversine 距離 (PostgreSQL + PostGIS) の簡易例
    // RAW を使うときはバインド変数で SQL Injection を防止
    const [lat, lng] = location.split(',').map(Number);
    const meters = radius; // already in metres

    return await this.prisma.prisma.$queryRaw<string[]>(
      Prisma.sql`
      SELECT
        dm.id
      FROM restaurants r
        JOIN dishes d        ON d.restaurant_id = r.id
        -- ここで「各 dish の最新メディア 1件」に絞る（d:dm=1:1）
        JOIN LATERAL (
          SELECT dm.*
          FROM dish_media dm
          WHERE dm.dish_id = d.id
          ORDER BY dm.created_at DESC, dm.id DESC
          LIMIT 1
        ) dm ON TRUE
      WHERE
        ( ST_DistanceSphere(r.location, ST_MakePoint(${lng}, ${lat})) <= ${meters} )
        AND (${categoryId} IS NULL OR d.category_id = ${categoryId})
        AND (
          ${viewerId} IS NULL OR
          dm.id NOT IN (
            SELECT dish_media_id FROM user_seen_dish WHERE user_id = ${viewerId}
          )
        )
        AND (
          ${cursor} IS NULL
          OR (
            ${sort} = '-createdAt' AND dm.created_at < ${cursor}
            OR ${sort} = 'createdAt' AND dm.created_at > ${cursor}
            OR ${sort} = 'distance' AND ST_DistanceSphere(r.location, ST_MakePoint(${lng}, ${lat})) > ${cursor}
          )
        )
      GROUP BY r.id, d.id, dm.id
      ORDER BY
        CASE
          WHEN ${sort} = 'createdAt' THEN dm.created_at
        END ASC,
        CASE
          WHEN ${sort} = '-createdAt' OR ${sort} IS NULL THEN dm.created_at
        END DESC,
        CASE
          WHEN ${sort} = 'distance' THEN ST_DistanceSphere(r.location, ST_MakePoint(${lng}, ${lat}))
        END ASC
      LIMIT ${limit};
    `,
    );
  }

  /* ------------------------------------------------------------------ */
  /*    レストランの料理メディアを取得（各料理のメディア1件、いいね数が最大のもの） */
  /* ------------------------------------------------------------------ */
  async findDishMediaByRestaurant(
    restaurantId: string,
    { limit = 42, cursor: cursorStr }: QueryRestaurantDishMediaDto,
  ) {
    const cursor = cursorStr
      ? {
        likeCount: Number(cursorStr.split('_')[0]),
        mediaId: cursorStr.split('_')[1],
      }
      : null;
    const cursorWhere = cursor
      ? Prisma.sql`
          AND (
            ranked.like_count < ${cursor.likeCount}
            OR (ranked.like_count = ${cursor.likeCount} AND ranked.dish_media_id < ${cursor.mediaId})
          )
        `
      : Prisma.empty;

    const rows = await this.prisma.prisma.$queryRaw<
      { dish_media_id: string; dish_id: string; like_count: number }[]
    >(Prisma.sql`
      WITH media_like_counts AS (
        SELECT
          dm.id        AS dish_media_id,
          dm.dish_id   AS dish_id,
          COUNT(dml.id) AS like_count
        FROM dish_media dm
        JOIN dishes d
          ON d.id = dm.dish_id
        LEFT JOIN dish_media_likes dml
          ON dml.dish_media_id = dm.id
        WHERE d.restaurant_id = ${restaurantId}
        GROUP BY dm.id, dm.dish_id
      ),
      ranked AS (
        SELECT
          mlc.*,
          ROW_NUMBER() OVER (
            PARTITION BY mlc.dish_id
            ORDER BY mlc.like_count DESC, mlc.dish_media_id DESC
          ) AS rn
        FROM media_like_counts mlc
      )
      SELECT
        ranked.dish_media_id,
        ranked.dish_id,
        ranked.like_count
      FROM ranked
      WHERE ranked.rn = 1
        ${cursorWhere}
      ORDER BY ranked.like_count DESC, ranked.dish_media_id DESC
      LIMIT ${limit};
    `);

    // 次ページ用カーソル（取得できた最後の行の複合キーをそのまま返す）
    const last = rows[rows.length - 1];
    const nextCursor: string | null = last
      ? `${last.like_count}_${last.dish_media_id}`
      : null;

    return { items: rows, nextCursor };
  }

  /* ------------------------------------------------------------------ */
  /*   ユーザーがレビューした料理レビューを取得する                     */
  /* ------------------------------------------------------------------ */
  async findDishReviewsByUser(
    userId: string,
    cursor?: string,
    limit = 42,
  ): Promise<DishMediaEntryEntity['dish_reviews']> {
    this.logger.debug(
      'FindDishMediaEntryByReviewedUser',
      'findDishMediaEntryByReviewedUser',
      {
        userId,
        cursor,
        limit,
      },
    );

    const whereClause: any = {
      user_id: userId,
    };

    if (cursor) {
      whereClause.created_at = {
        lt: new Date(cursor),
      };
    }

    const reviews = await this.prisma.prisma.dish_reviews.findMany({
      where: whereClause,
      orderBy: { created_at: 'desc' },
      take: limit,
      include: {
        users: true,
      },
    });

    const { reactionSet, reviewLikeCountMap } =
      await this.buildReactionAggregates(
        reviews.map((review) => review.created_dish_media_id),
        reviews.map((review) => review.id),
        userId,
      );

    return reviews.map((review) => ({
      ...review,
      username:
        review.imported_user_name ?? review.users?.display_name ?? 'unknown',
      isLiked: reactionSet.has(
        this.reactionKey('dish_reviews', review.id, 'like'),
      ),
      likeCount: reviewLikeCountMap.get(review.id) ?? 0,
    }));
  }

  /* ------------------------------------------------------------------ */
  /*        ユーザーが「いいね」した dish_media を取得                 */
  /* ------------------------------------------------------------------ */
  async findDishMediaByLikedUser(
    userId: string,
    cursor?: string,
    limit = 42,
  ): Promise<{ dish_media_id: string; created_at: Date }[]> {
    this.logger.debug('findDishMediaByLikedUser', 'findDishMediaByLikedUser', {
      userId,
      cursor,
      limit,
    });

    const whereClause: any = {
      user_id: userId,
      target_type: 'dish_media',
      action_type: 'like',
    };
    if (cursor) {
      whereClause.created_at = { lt: new Date(cursor) };
    }

    const likes = await this.prisma.prisma.reactions.findMany({
      where: whereClause,
      orderBy: { created_at: 'desc' },
      take: limit,
      select: { target_id: true, created_at: true },
    });

    const result = likes.map((r) => ({
      dish_media_id: r.target_id,
      created_at: r.created_at,
    }));

    // TODO: ログインユーザーの場合
    // const whereClause: any = { user_id: userId };
    // if (cursor) {
    //   whereClause.created_at = { lt: new Date(cursor) };
    // }

    // const likes = await this.prisma.prisma.dish_media_likes.findMany({
    //   where: whereClause,
    //   orderBy: { created_at: 'desc' },
    //   take: limit,
    //   select: { dish_media_id: true, created_at: true },
    // });

    this.logger.debug(
      'findDishMediaByLikedUserResult',
      'findDishMediaByLikedUser',
      { count: result.length },
    );

    return result;
  }

  /* ------------------------------------------------------------------ */
  /*        ユーザーが「保存」した dish_media を取得                  */
  /* ------------------------------------------------------------------ */
  async findDishMediaBySavedUser(
    userId: string,
    cursor?: string,
    limit = 42,
  ): Promise<{ dish_media_id: string; created_at: Date }[]> {
    this.logger.debug('findDishMediaBySavedUser', 'findDishMediaBySavedUser', {
      userId,
      cursor,
      limit,
    });

    const whereClause: any = {
      user_id: userId,
      target_type: 'dish_media',
      action_type: 'save',
    };
    if (cursor) {
      whereClause.created_at = { lt: new Date(cursor) };
    }

    const saves = await this.prisma.prisma.reactions.findMany({
      where: whereClause,
      orderBy: { created_at: 'desc' },
      take: limit,
      select: { target_id: true, created_at: true },
    });

    const result = saves.map((r) => ({
      dish_media_id: r.target_id,
      created_at: r.created_at,
    }));

    this.logger.debug(
      'findDishMediaBySavedUserResult',
      'findDishMediaBySavedUser',
      { count: result.length },
    );

    return result;
  }

  /**
   * dishMediaIds から DishMediaEntryEntity 配列を構築
   *  - dish_media 本体 / dishes.restaurants
   *  - user の like/save 状態 (dish_media_likes + reactions)
   *  - review の like 状態 & likeCount
   *  - 順序は入力 dishMediaIds の順を維持
   */
  async getDishMediaEntriesByIds(
    dishMediaIds: string[],
    option: {
      userId?: string;
      reviewLimit?: number;
    },
  ): Promise<DishMediaEntryEntity[]> {
    const { userId, reviewLimit = 6 } = option;
    if (dishMediaIds.length === 0) return [];

    const dishMedias = await this.prisma.prisma.dish_media.findMany({
      where: { id: { in: dishMediaIds } },
      include: {
        dish_media_likes: { where: { user_id: userId } }, // User がいいねしているか
        _count: { select: { dish_media_likes: true } }, // いいね数を取得
        dishes: {
          include: {
            restaurants: true,
            dish_reviews: {
              orderBy: { created_at: 'desc' },
              take: reviewLimit,
              include: { users: true },
            },
          },
        },
      },
    });

    // Get all dish IDs to calculate aggregates
    const dishIds = dishMedias.map((m) => m.dish_id);

    // Calculate review count and average rating per dish
    const avgByDish = await this.prisma.prisma.dish_reviews.groupBy({
      by: ['dish_id'],
      where: { dish_id: { in: dishIds } },
      _avg: { rating: true },
      _count: { dish_id: true },
    });

    const dishStatsMap = new Map<
      string,
      { averageRating: number; reviewCount: number }
    >(
      avgByDish.map((row) => {
        const avg = row._avg.rating ?? 0;
        return [
          row.dish_id,
          {
            averageRating: Math.round(avg * 10) / 10, // ROUND(AVG, 1)
            reviewCount: row._count.dish_id,
          },
        ];
      }),
    );

    const dishMediaMap = new Map(dishMedias.map((m) => [m.id, m]));
    const allReviewIds = dishMedias.flatMap((m) =>
      m.dishes.dish_reviews.map((r) => r.id),
    );

    const { reactionSet, reviewLikeCountMap } =
      await this.buildReactionAggregates(dishMediaIds, allReviewIds, userId);

    return dishMediaIds
      .filter((dishMediaId) => {
        const dishMedia = dishMediaMap.get(dishMediaId);
        if (!dishMedia) {
          this.logger.warn('DishMediaNotFound', 'getDishMediaEntriesByIds', {
            dishMediaId,
          });
          return false;
        }
        return true;
      }) //
      .map((dishMediaId) => {
        const dishMedia = dishMediaMap.get(dishMediaId)!;
        const dishStats = dishStatsMap.get(dishMedia.dish_id)!;
        const dishReviews = dishMedia.dishes.dish_reviews;

        return {
          restaurant: dishMedia.dishes.restaurants,
          dish: {
            ...dishMedia.dishes,
            reviewCount: dishStats.reviewCount,
            averageRating: dishStats.averageRating,
          },
          dish_media: {
            ...(dishMedia as PrismaDishMedia),
            isSaved: reactionSet.has(
              this.reactionKey('dish_media', dishMedia.id, 'save'),
            ),
            isLiked:
              dishMedia.dish_media_likes.length > 0 ||
              reactionSet.has(
                this.reactionKey('dish_media', dishMedia.id, 'like'),
              ),
            likeCount: dishMedia._count.dish_media_likes, // 【設計】likeCount に reactions(匿名ユーザー)は含めない
          },
          dish_reviews: dishReviews.map((review) => ({
            ...review,
            username:
              review.imported_user_name ??
              review.users?.display_name ??
              'unknown',
            isLiked: reactionSet.has(
              this.reactionKey('dish_reviews', review.id, 'like'),
            ),
            likeCount: reviewLikeCountMap.get(review.id) ?? 0,
          })),
        };
      });
  }

  // --- new helper ---
  private async buildReactionAggregates(
    dishMediaIds: string[],
    reviewIds: string[],
    userId?: string,
  ): Promise<{
    reactionSet: Set<string>;
    reviewLikeCountMap: Map<string, number>;
  }> {
    const reviewLikeCounts = reviewIds.length
      ? await this.prisma.prisma.reactions.groupBy({
        by: ['target_id'],
        where: {
          target_type: 'dish_reviews',
          target_id: { in: reviewIds },
          action_type: 'like',
        },
        _count: { target_id: true },
      })
      : [];
    const reviewLikeCountMap = new Map(
      reviewLikeCounts.map((r) => [r.target_id, r._count.target_id]),
    );

    if (!userId) {
      return {
        reactionSet: new Set<string>(),
        reviewLikeCountMap,
      };
    }

    const targetIds = [...dishMediaIds, ...reviewIds];
    const userReactions = targetIds.length
      ? await this.prisma.prisma.reactions.findMany({
        where: {
          user_id: userId,
          target_id: { in: targetIds },
        },
        select: { target_type: true, target_id: true, action_type: true },
      })
      : [];
    const reactionSet = new Set(
      userReactions.map((r) =>
        this.reactionKey(r.target_type, r.target_id, r.action_type),
      ),
    );

    return { reactionSet, reviewLikeCountMap };
  }

  /* ------------------------------------------------------------------ */
  /*                     いいね / いいね解除                         */
  /* ------------------------------------------------------------------ */
  async likeDishMedia(id: string, userId: string): Promise<void> {
    await this.prisma.prisma.dish_media_likes.upsert({
      where: { dish_media_id_user_id: { dish_media_id: id, user_id: userId } },
      update: {},
      create: {
        dish_media_id: id,
        user_id: userId,
      },
    });
  }

  async unlikeDishMedia(id: string, userId: string): Promise<void> {
    await this.prisma.prisma.dish_media_likes.deleteMany({
      where: { dish_media_id: id, user_id: userId },
    });
  }

  /* ------------------------------------------------------------------ */
  /*                     保存（reactions テーブル想定）               */
  /* ------------------------------------------------------------------ */
  async saveDishMedia(id: string, userId: string): Promise<void> {
    // TODO: migration
    // await this.prisma.prisma.reactions.upsert({
    //     where: { dish_media_id_user_id: { dish_media_id: id, user_id: userId } },
    //     update: { type: 'SAVE' },
    //     create: { dish_media_id: id, user_id: userId, type: 'SAVE' },
    // });
  }

  /* ------------------------------------------------------------------ */
  /*                            Dish 存在確認                        */
  /* ------------------------------------------------------------------ */
  async dishExists(dishId: string): Promise<boolean> {
    const cnt = await this.prisma.prisma.dishes.count({
      where: { id: dishId },
    });
    return cnt > 0;
  }

  /* ------------------------------------------------------------------ */
  /*        dish_media 投稿 (トランザクション内で呼び出し)           */
  /* ------------------------------------------------------------------ */
  async createDishMedia(
    tx: Prisma.TransactionClient,
    dto: CreateDishMediaDto,
    creatorId: string,
    thumbnailPath: string,
  ) {
    // 画像は既に Storage へアップ済みとして mediaPath を受け取る
    const newMedia = await tx.dish_media.create({
      data: {
        dish_id: dto.dishId,
        user_id: creatorId,
        media_path: dto.mediaPath,
        media_type: dto.mediaType,
        thumbnail_path: thumbnailPath,
      },
    });

    // “本人を既読”にするなど副次レコードを入れたければここで
    // TODO: migration
    // await tx.user_seen_dish.create({
    //     data: { user_id: creatorId, dish_media_id: newMedia.id },
    // });

    return newMedia;
  }
}
