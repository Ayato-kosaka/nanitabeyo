// api/src/modules/users/users.mapper.ts
//
// ❶ Repository → Controller 公開型（QueryUserXxxResponse）へ変換
// ❷ Prisma → Supabase 型は shared/converters のユーティリティを reuse
//

import { Injectable } from '@nestjs/common';

import { UserDishReviewItem, LikedDishMediaItem, SavedDishMediaItem } from './users.repository';
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
import { convertPrismaToSupabase_Payouts } from '../../../../shared/converters/convert_payouts';
import { convertPrismaToSupabase_RestaurantBids } from '../../../../shared/converters/convert_restaurant_bids';
import { convertPrismaToSupabase_DishCategories } from '../../../../shared/converters/convert_dish_categories';
import { PrismaPayouts } from '../../../../shared/converters/convert_payouts';
import { PrismaRestaurantBids } from '../../../../shared/converters/convert_restaurant_bids';
import { PrismaDishCategories } from '../../../../shared/converters/convert_dish_categories';

@Injectable()
export class UsersMapper {
  /**
   * Repository から取得した `UserDishReviewItem[]` を
   * Controller が返す `QueryUserDishReviewsResponse` に整形する
   */
  toUserDishReviewsResponse(
    items: (UserDishReviewItem & { signedUrls: string[] })[],
  ): QueryUserDishReviewsResponse {
    return items.map((src) => ({
      dish_media: convertPrismaToSupabase_DishMedia(src.dish_media),
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
    items: (LikedDishMediaItem & { signedUrls: string[] })[],
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
  toMePayoutsResponse(
    items: PrismaPayouts[],
  ): QueryMePayoutsResponse {
    return items.map((src) => convertPrismaToSupabase_Payouts(src));
  }

  /**
   * Repository から取得した `PrismaRestaurantBids[]` を
   * Controller が返す `QueryMeRestaurantBidsResponse` に整形する
   */
  toMeRestaurantBidsResponse(
    items: PrismaRestaurantBids[],
  ): QueryMeRestaurantBidsResponse {
    return items.map((src) => convertPrismaToSupabase_RestaurantBids(src));
  }

  /**
   * Repository から取得した `PrismaDishCategories[]` を
   * Controller が返す `QueryMeSavedDishCategoriesResponse` に整形する
   */
  toMeSavedDishCategoriesResponse(
    items: (PrismaDishCategories & { signedUrls: string[] })[],
  ): QueryMeSavedDishCategoriesResponse {
    return items.map((src) => convertPrismaToSupabase_DishCategories(src));
  }

  /**
   * Repository から取得した `SavedDishMediaItem[]` を
   * Controller が返す `QueryMeSavedDishMediaResponse` に整形する
   */
  toMeSavedDishMediaResponse(
    items: (SavedDishMediaItem & { signedUrls: string[] })[],
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