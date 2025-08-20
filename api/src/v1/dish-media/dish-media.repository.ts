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
  QueryDishMediaDto,
  LikeDishMediaParamsDto,
  SaveDishMediaParamsDto,
} from '@shared/v1/dto';

import { PrismaService } from '../../prisma/prisma.service';

/* -------------------------------------------------------------------------- */
/*                       返却型 (ドメイン Entity 例)                           */
/* -------------------------------------------------------------------------- */
export interface DishMediaEntryEntity {
  restaurant: PrismaRestaurants;
  dish: PrismaDishes;
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
  constructor(private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService) { }

  /* ------------------------------------------------------------------ */
  /*   料理メディアを位置 + カテゴリ + 未閲覧 で取得（返却数固定）    */
  /* ------------------------------------------------------------------ */
  async findDishMedias(
    { location, radius, categoryId }: QueryDishMediaDto,
    viewerId?: string,
  ): Promise<DishMediaEntryEntity[]> {
    // Haversine 距離 (PostgreSQL + PostGIS) の簡易例
    // RAW を使うときはバインド変数で SQL Injection を防止
    const [lat, lng] = location.split(',').map(Number);
    const meters = radius; // already in metres

    return this.prisma.prisma.$queryRaw<DishMediaEntryEntity[]>(
      Prisma.sql`
      SELECT
        r.id AS restaurant_id,
        r.name,
        r.latitude,
        r.longitude,
        r.location,
        d.id AS dish_id,
        d.name AS dish_name,
        d.category_id,
        dm.id AS dish_media_id,
        dm.media_path,
        dm.media_type,
        dm.created_at,
        json_agg(
          json_build_object(
            'id', dr.id,
            'user_id', dr.user_id,
            'rating', dr.rating,
            'comment', dr.comment,
            'created_at', dr.created_at
          ) ORDER BY dr.created_at DESC
        ) AS dish_reviews
      FROM restaurants r
        JOIN dishes d        ON d.restaurant_id = r.id
        JOIN dish_media dm   ON dm.dish_id = d.id
        LEFT JOIN dish_reviews dr ON dr.dish_id = d.id
      WHERE
        ( ST_DistanceSphere(r.location, ST_MakePoint(${lng}, ${lat})) <= ${meters} )
        AND (${categoryId} IS NULL OR d.category_id = ${categoryId})
        AND (
          ${viewerId} IS NULL OR
          dm.id NOT IN (
            SELECT dish_media_id FROM user_seen_dish WHERE user_id = ${viewerId}
          )
        )
      GROUP BY r.id, d.id, dm.id
      ORDER BY dm.created_at DESC
      LIMIT 1;
    `,
    );
  }

  /* ------------------------------------------------------------------ */
  /*   ユーザーがレビューした料理メディアエントリーを取得する           */
  /* ------------------------------------------------------------------ */
  async findDishMediaEntryByReviewedUser(userId: string, cursor?: string, limit = 42): Promise<DishMediaEntryEntity[]> {
    this.logger.debug('FindDishMediaEntryByReviewedUser', 'findDishMediaEntryByReviewedUser', {
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

    const reviews = await this.prisma.prisma.dish_reviews.findMany({
      where: whereClause,
      orderBy: { created_at: 'desc' },
      take: limit,
      include: {
        users: true,
      },
    });
    const dishMediaIds = reviews.map(review => review.created_dish_media_id).filter(id => id !== null);// TODO migration して null は外す。

    const dishMediaEntries = await this.getDishMediaEntriesByIds(dishMediaIds, userId, 0);

    return dishMediaEntries;
  }

  /**
   * dishMediaIds から DishMediaEntryEntity 配列を構築
   *  - dish_media 本体 / dishes.restaurants
   *  - user の like/save 状態 (dish_likes + reactions)
   *  - review の like 状態 & likeCount
   *  - 順序は入力 dishMediaIds の順を維持
   */
  private async getDishMediaEntriesByIds(
    dishMediaIds: string[],
    userId: string,
    limit: number,
  ): Promise<DishMediaEntryEntity[]> {
    if (dishMediaIds.length === 0) return [];

    const dishMedias = await this.prisma.prisma.dish_media.findMany({
      where: { id: { in: dishMediaIds } },
      include: {
        dish_likes: { where: { user_id: userId } }, // User がいいねしているか
        _count: { select: { dish_likes: true } }, // いいね数を取得
        dishes: { include: { restaurants: true } },
        dish_reviews: {
          orderBy: { created_at: 'desc' },
          take: limit,
          include: { users: true },
        },
      },
    });

    const dishMediaMap = new Map(dishMedias.map(m => [m.id, m]));

    const allReviewIds = dishMedias.flatMap(m => m.dish_reviews.map(r => r.id));

    const userReactions = await this.prisma.prisma.reactions.findMany({
      where: {
        user_id: userId,
        target_id: { in: [...dishMediaIds, ...allReviewIds] },
      },
      select: { target_type: true, target_id: true, action_type: true },
    });
    const reactionKey = (t: string, id: string, action: string) => `${t}:${id}:${action}`;
    const reactionSet = new Set(userReactions.map(r => reactionKey(r.target_type, r.target_id, r.action_type)));

    const reviewLikeCounts = await this.prisma.prisma.reactions.groupBy({
      by: ['target_id'],
      where: {
        target_type: 'dish_reviews',
        target_id: { in: allReviewIds },
        action_type: 'like',
      },
      _count: { target_id: true },
    });
    const reviewLikeCountMap = new Map(reviewLikeCounts.map(r => [r.target_id, r._count.target_id]));

    return dishMediaIds.map(dishMediaId => {
      const dishMedia = dishMediaMap.get(dishMediaId);
      if (!dishMedia) {
        this.logger.warn('DishMediaNotFound', 'getDishMediaEntriesByIds', { dishMediaId });
        throw new Error(`Dish media not found for ID: ${dishMediaId}`);
      }
      return {
        restaurant: dishMedia.dishes.restaurants!, // TODO migration して ! は外す。
        dish: dishMedia.dishes,
        dish_media: {
          ...dishMedia as PrismaDishMedia,
          isSaved: reactionSet.has(reactionKey('dish_media', dishMedia.id, 'save')),
          isLiked: dishMedia.dish_likes.length > 0 ||
            reactionSet.has(reactionKey('dish_media', dishMedia.id, 'like')),
          likeCount: dishMedia._count.dish_likes, // 【設計】dish_media の likeCount に reactions(匿名ユーザー)は含めない
        },
        dish_reviews: dishMedia.dish_reviews.map(review => ({
          ...review,
          username: review.imported_user_name ?? review.users?.display_name ?? 'unknown',
          isLiked: reactionSet.has(reactionKey('dish_reviews', review.id, 'like')),
          likeCount: reviewLikeCountMap.get(review.id) ?? 0,
        })),
      };
    });
  }

  /* ------------------------------------------------------------------ */
  /*                     いいね / いいね解除                         */
  /* ------------------------------------------------------------------ */
  async likeDishMedia(id: string, userId: string): Promise<void> {
    await this.prisma.prisma.dish_likes.upsert({
      where: { dish_media_id_user_id: { dish_media_id: id, user_id: userId } },
      update: {},
      create: {
        dish_media_id: id,
        user_id: userId,
      },
    });
  }

  async unlikeDishMedia(id: string, userId: string): Promise<void> {
    await this.prisma.prisma.dish_likes.deleteMany({
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
