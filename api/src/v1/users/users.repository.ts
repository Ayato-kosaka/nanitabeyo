// api/src/modules/users/users.repository.ts
//
// 🎯 目的
//   • Prisma を "1 つのデータ取得 API" として隠蔽し、Service から直アクセスさせない
//   • ユーザー関連の各種データ取得クエリを 1 箇所に集約
//   • 返却は **ドメイン Entity** に近い形（型安全 & Service で再集計不要）
//

import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../shared/prisma/client';
import { PrismaRestaurants } from '../../../../shared/converters/convert_restaurants';
import { PrismaDishes } from '../../../../shared/converters/convert_dishes';
import { PrismaDishMedia } from '../../../../shared/converters/convert_dish_media';
import { PrismaDishReviews } from '../../../../shared/converters/convert_dish_reviews';
import { PrismaPayouts } from '../../../../shared/converters/convert_payouts';
import { PrismaRestaurantBids } from '../../../../shared/converters/convert_restaurant_bids';
import { PrismaDishCategories } from '../../../../shared/converters/convert_dish_categories';

import {
  QueryUserDishReviewsDto,
  QueryMeLikedDishMediaDto,
  QueryMePayoutsDto,
  QueryMeRestaurantBidsDto,
  QueryMeSavedDishCategoriesDto,
  QueryMeSavedDishMediaDto,
} from '@shared/v1/dto';

import { PrismaService } from '../../prisma/prisma.service';

/* -------------------------------------------------------------------------- */
/*                       返却型 (ドメイン Entity 例)                           */
/* -------------------------------------------------------------------------- */
export interface UserDishReviewItem {
  dish_media: PrismaDishMedia;
  dish_review: PrismaDishReviews;
  hasMedia: boolean;
}

export interface LikedDishMediaItem {
  restaurant: PrismaRestaurants;
  dish: PrismaDishes;
  dish_media: PrismaDishMedia;
  dish_reviews: PrismaDishReviews[];
}

export interface SavedDishMediaItem {
  restaurant: PrismaRestaurants;
  dish: PrismaDishes;
  dish_media: PrismaDishMedia;
  dish_reviews: PrismaDishReviews[];
}

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /* ------------------------------------------------------------------ */
  /*                    1) ユーザーのレビュー一覧取得                    */
  /* ------------------------------------------------------------------ */
  async getUserDishReviews(
    userId: string,
    { cursor }: QueryUserDishReviewsDto,
  ): Promise<UserDishReviewItem[]> {
    const limit = 42;
    
    // カーソルは created_at の ISO string を想定
    const whereCondition: Prisma.dish_reviewsWhereInput = {
      user_id: userId,
      ...(cursor && { created_at: { lt: new Date(cursor) } }),
    };

    return this.prisma.$queryRaw<UserDishReviewItem[]>(
      Prisma.sql`
        SELECT 
          dr.id as review_id,
          dr.dish_id, 
          dr.rating, 
          dr.comment,
          dr.created_at,
          dm.id as dish_media_id,
          dm.media_path,
          dm.media_type,
          dm.user_id = ${userId} AS hasMedia
        FROM dish_reviews dr
        LEFT JOIN dish_media dm ON dr.dish_media_id = dm.id
        WHERE dr.user_id = ${userId}
        ${cursor ? Prisma.sql`AND dr.created_at < ${new Date(cursor)}` : Prisma.empty}
        ORDER BY dr.created_at DESC
        LIMIT ${limit}
      `,
    );
  }

  /* ------------------------------------------------------------------ */
  /*                  2) 自分がいいねした料理メディア一覧               */
  /* ------------------------------------------------------------------ */
  async getMeLikedDishMedia(
    userId: string,
    { cursor }: QueryMeLikedDishMediaDto,
  ): Promise<LikedDishMediaItem[]> {
    const limit = 42;

    // First get liked dish_media_ids
    const likedMediaIds = await this.prisma.$queryRaw<{ dish_media_id: string; created_at: Date }[]>(
      Prisma.sql`
        SELECT dish_media_id, created_at
        FROM dish_likes
        WHERE user_id = ${userId}
        ${cursor ? Prisma.sql`AND created_at < ${new Date(cursor)}` : Prisma.empty}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `,
    );

    if (likedMediaIds.length === 0) return [];

    const mediaIds = likedMediaIds.map(item => item.dish_media_id);

    // Then get full dish media with related data
    return this.prisma.$queryRaw<LikedDishMediaItem[]>(
      Prisma.sql`
        SELECT 
          r.id as restaurant_id,
          r.name as restaurant_name,
          r.location as restaurant_location,
          d.id as dish_id,
          d.name as dish_name,
          d.category_id,
          dm.id as dish_media_id,
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
        FROM dish_media dm
        JOIN dishes d ON dm.dish_id = d.id
        JOIN restaurants r ON d.restaurant_id = r.id
        LEFT JOIN dish_reviews dr ON dr.dish_id = d.id
        WHERE dm.id = ANY(${mediaIds})
        GROUP BY r.id, d.id, dm.id
        ORDER BY dm.id
      `,
    );
  }

  /* ------------------------------------------------------------------ */
  /*                        3) 自分の収益一覧                          */
  /* ------------------------------------------------------------------ */
  async getMePayouts(
    userId: string,
    { cursor }: QueryMePayoutsDto,
  ): Promise<PrismaPayouts[]> {
    const limit = 42;

    const whereCondition: Prisma.payoutsWhereInput = {
      // Assuming payouts table has user_id or linked through dish_media
      // This may need adjustment based on actual schema
      ...(cursor && { created_at: { lt: new Date(cursor) } }),
    };

    return this.prisma.payouts.findMany({
      where: whereCondition,
      orderBy: { created_at: 'desc' },
      take: limit,
    });
  }

  /* ------------------------------------------------------------------ */
  /*                      4) 自分の入札履歴一覧                        */
  /* ------------------------------------------------------------------ */
  async getMeRestaurantBids(
    userId: string,
    { cursor }: QueryMeRestaurantBidsDto,
  ): Promise<PrismaRestaurantBids[]> {
    const limit = 42;

    const whereCondition: Prisma.restaurant_bidsWhereInput = {
      user_id: userId,
      ...(cursor && { created_at: { lt: new Date(cursor) } }),
    };

    return this.prisma.restaurant_bids.findMany({
      where: whereCondition,
      orderBy: { created_at: 'desc' },
      take: limit,
    });
  }

  /* ------------------------------------------------------------------ */
  /*                    5) 自分の保存カテゴリ一覧                      */
  /* ------------------------------------------------------------------ */
  async getMeSavedDishCategories(
    userId: string,
    { cursor }: QueryMeSavedDishCategoriesDto,
  ): Promise<PrismaDishCategories[]> {
    const limit = 42;

    // Assuming reactions table with target_type='dish_category' and action_type='SAVE'
    return this.prisma.$queryRaw<PrismaDishCategories[]>(
      Prisma.sql`
        SELECT 
          dc.id,
          dc.label_en,
          dc.labels,
          dc.image_url,
          dc.tags,
          dc.created_at,
          dc.updated_at,
          dc.lock_no
        FROM dish_categories dc
        JOIN reactions r ON dc.id = r.target_id
        WHERE r.user_id = ${userId}
          AND r.target_type = 'dish_category'
          AND r.action_type = 'SAVE'
          ${cursor ? Prisma.sql`AND r.created_at < ${new Date(cursor)}` : Prisma.empty}
        ORDER BY r.created_at DESC
        LIMIT ${limit}
      `,
    );
  }

  /* ------------------------------------------------------------------ */
  /*                  6) 保存済み料理メディア一覧                      */
  /* ------------------------------------------------------------------ */
  async getMeSavedDishMedia(
    userId: string,
    { cursor }: QueryMeSavedDishMediaDto,
  ): Promise<SavedDishMediaItem[]> {
    const limit = 42;

    // First get saved dish_media_ids from reactions
    const savedMediaIds = await this.prisma.$queryRaw<{ target_id: string; created_at: Date }[]>(
      Prisma.sql`
        SELECT target_id, created_at
        FROM reactions
        WHERE user_id = ${userId}
          AND target_type = 'dish_media'
          AND action_type = 'SAVE'
          ${cursor ? Prisma.sql`AND created_at < ${new Date(cursor)}` : Prisma.empty}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `,
    );

    if (savedMediaIds.length === 0) return [];

    const mediaIds = savedMediaIds.map(item => item.target_id);

    // Then get full dish media with related data
    return this.prisma.$queryRaw<SavedDishMediaItem[]>(
      Prisma.sql`
        SELECT 
          r.id as restaurant_id,
          r.name as restaurant_name,
          r.location as restaurant_location,
          d.id as dish_id,
          d.name as dish_name,
          d.category_id,
          dm.id as dish_media_id,
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
        FROM dish_media dm
        JOIN dishes d ON dm.dish_id = d.id
        JOIN restaurants r ON d.restaurant_id = r.id
        LEFT JOIN dish_reviews dr ON dr.dish_id = d.id
        WHERE dm.id = ANY(${mediaIds})
        GROUP BY r.id, d.id, dm.id
        ORDER BY dm.id
      `,
    );
  }
}