// api/src/v1/users/users.mapper.ts
//
// ❶ Repository → Controller 公開型（Response）へ変換
// ❷ Prisma → Supabase 型は shared/converters のユーティリティを reuse
//

import { Injectable } from '@nestjs/common';

import {
  UserDishReviewItem,
  LikedDishMediaItem,
  SavedDishMediaItem,
} from './users.repository';
import {
  QueryUserDishReviewsResponse,
  QueryMeLikedDishMediaResponse,
  QueryMePayoutsResponse,
  QueryMeRestaurantBidsResponse,
  QueryMeSavedDishCategoriesResponse,
  QueryMeSavedDishMediaResponse,
} from '@shared/v1/res';

import { convertPrismaToSupabase_Restaurants } from '../../../../shared/converters/convert_restaurants';
import { convertPrismaToSupabase_Dishes } from '../../../../shared/converters/convert_dishes';
import { convertPrismaToSupabase_DishMedia } from '../../../../shared/converters/convert_dish_media';
import { convertPrismaToSupabase_DishReviews } from '../../../../shared/converters/convert_dish_reviews';
import { PrismaPayouts } from '../../../../shared/converters/convert_payouts';
import { PrismaRestaurantBids } from '../../../../shared/converters/convert_restaurant_bids';
import { PrismaDishCategories } from '../../../../shared/converters/convert_dish_categories';
import { SupabasePayouts } from '../../../../shared/converters/convert_payouts';
import { SupabaseRestaurantBids } from '../../../../shared/converters/convert_restaurant_bids';
import { SupabaseDishCategories } from '../../../../shared/converters/convert_dish_categories';

@Injectable()
export class UsersMapper {
  /**
   * Safe converter for Payouts that handles bigint type mismatch
   */
  private convertPayoutsSafe(prisma: PrismaPayouts): SupabasePayouts {
    return {
      id: prisma.id,
      bid_id: prisma.bid_id,
      transfer_id: prisma.transfer_id,
      dish_media_id: prisma.dish_media_id,
      amount_cents: Number(prisma.amount_cents), // Convert bigint to number
      currency_code: prisma.currency_code,
      status: prisma.status as any,
      created_at: prisma.created_at?.toISOString() ?? null,
      updated_at: prisma.updated_at?.toISOString() ?? null,
      lock_no: prisma.lock_no,
    };
  }

  /**
   * Safe converter for RestaurantBids that handles bigint type mismatch
   */
  private convertRestaurantBidsSafe(
    prisma: PrismaRestaurantBids,
  ): SupabaseRestaurantBids {
    return {
      id: prisma.id,
      restaurant_id: prisma.restaurant_id,
      user_id: prisma.user_id,
      payment_intent_id: prisma.payment_intent_id,
      amount_cents: Number(prisma.amount_cents), // Convert bigint to number
      currency_code: prisma.currency_code,
      start_date: prisma.start_date?.toISOString()?.split('T')[0] ?? null,
      end_date: prisma.end_date?.toISOString()?.split('T')[0] ?? null,
      status: prisma.status as any,
      refund_id: prisma.refund_id,
      created_at: prisma.created_at?.toISOString() ?? null,
      updated_at: prisma.updated_at?.toISOString() ?? null,
      lock_no: prisma.lock_no,
    };
  }

  /**
   * Safe converter for DishCategories that handles array null type mismatch
   */
  private convertDishCategoriesSafe(
    prisma: PrismaDishCategories,
  ): SupabaseDishCategories {
    return {
      id: prisma.id,
      label_en: prisma.label_en,
      labels: prisma.labels as any,
      image_url: prisma.image_url,
      origin: prisma.origin || [], // Handle potential null
      cuisine: prisma.cuisine || [], // Handle potential null
      tags: prisma.tags || [], // Handle potential null
      created_at: prisma.created_at?.toISOString() ?? null,
      updated_at: prisma.updated_at?.toISOString() ?? null,
      lock_no: prisma.lock_no,
    };
  }

  /**
   * Repository から取得した `UserDishReviewItem[]` を
   * Controller が返す `QueryUserDishReviewsResponse` に整形する
   */
  toUserDishReviewsResponse(
    items: (UserDishReviewItem & { signedUrls: string[] })[],
  ): QueryUserDishReviewsResponse {
    return items.map((src) => ({
      dish_media: src.dish_media
        ? convertPrismaToSupabase_DishMedia(src.dish_media)
        : null,
      dish_review: convertPrismaToSupabase_DishReviews(src.dish_review),
      signedUrls: src.signedUrls,
      hasMedia: src.hasMedia,
    }));
  }

  /**
   * Repository から取得した `LikedDishMediaItem[]` を
   * Controller が返す `QueryMeLikedDishMediaResponse` に整形する
   */
  toMeLikedDishMediaResponse(
    items: LikedDishMediaItem[],
  ): QueryMeLikedDishMediaResponse {
    return items.map((src) => ({
      restaurant: convertPrismaToSupabase_Restaurants(src.restaurant),
      dish: convertPrismaToSupabase_Dishes(src.dish),
      dish_media: convertPrismaToSupabase_DishMedia(src.dish_media),
      dish_reviews: src.dish_reviews.map((r) =>
        convertPrismaToSupabase_DishReviews(r),
      ),
    }));
  }

  /**
   * Repository から取得した `PrismaPayouts[]` を
   * Controller が返す `QueryMePayoutsResponse` に整形する
   */
  toMePayoutsResponse(items: PrismaPayouts[]): QueryMePayoutsResponse {
    return items.map((src) => this.convertPayoutsSafe(src));
  }

  /**
   * Repository から取得した `PrismaRestaurantBids[]` を
   * Controller が返す `QueryMeRestaurantBidsResponse` に整形する
   */
  toMeRestaurantBidsResponse(
    items: PrismaRestaurantBids[],
  ): QueryMeRestaurantBidsResponse {
    return items.map((src) => this.convertRestaurantBidsSafe(src));
  }

  /**
   * Repository から取得した `PrismaDishCategories[]` を
   * Controller が返す `QueryMeSavedDishCategoriesResponse` に整形する
   */
  toMeSavedDishCategoriesResponse(
    items: PrismaDishCategories[],
  ): QueryMeSavedDishCategoriesResponse {
    return items.map((src) => this.convertDishCategoriesSafe(src));
  }

  /**
   * Repository から取得した `SavedDishMediaItem[]` を
   * Controller が返す `QueryMeSavedDishMediaResponse` に整形する
   */
  toMeSavedDishMediaResponse(
    items: SavedDishMediaItem[],
  ): QueryMeSavedDishMediaResponse {
    return items.map((src) => ({
      restaurant: convertPrismaToSupabase_Restaurants(src.restaurant),
      dish: convertPrismaToSupabase_Dishes(src.dish),
      dish_media: convertPrismaToSupabase_DishMedia(src.dish_media),
      dish_reviews: src.dish_reviews.map((r) =>
        convertPrismaToSupabase_DishReviews(r),
      ),
    }));
  }
}
