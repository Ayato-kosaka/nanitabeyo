// api/src/v1/users/users.mapper.ts
//
// Response mapping logic for users endpoints
//

import { Injectable } from '@nestjs/common';
import {
  QueryUserDishReviewsResponse,
  QueryMeLikedDishMediaResponse,
  QueryMePayoutsResponse,
  QueryMeRestaurantBidsResponse,
  QueryMeSavedDishCategoriesResponse,
  QueryMeSavedDishMediaResponse,
} from '@shared/v1/res';
import { DishMediaEntryItem } from '../dish-media/dish-media.mapper';
import { convertPrismaToSupabase_Restaurants } from '../../../../shared/converters/convert_restaurants';
import { convertPrismaToSupabase_Dishes } from '../../../../shared/converters/convert_dishes';
import { convertPrismaToSupabase_DishMedia } from '../../../../shared/converters/convert_dish_media';
import { convertPrismaToSupabase_DishReviews } from '../../../../shared/converters/convert_dish_reviews';
import {
  convertPrismaToSupabase_DishCategories,
  PrismaDishCategories,
} from '../../../../shared/converters/convert_dish_categories';
import {
  convertPrismaToSupabase_Payouts,
  PrismaPayouts,
} from '../../../../shared/converters/convert_payouts';
import {
  convertPrismaToSupabase_RestaurantBids,
  PrismaRestaurantBids,
} from '../../../../shared/converters/convert_restaurant_bids';

@Injectable()
export class UsersMapper {
  /**
   * GET /v1/users/:id/dish-reviews のレスポンス変換
   */
  toUserDishReviewsResponse(result: {
    data: (DishMediaEntryItem & { dish_media: { isMe: boolean } })[];
    nextCursor: string | null;
  }): QueryUserDishReviewsResponse {
    return {
      data: result.data.map((src) => ({
        restaurant: convertPrismaToSupabase_Restaurants(src.restaurant),
        dish: convertPrismaToSupabase_Dishes(src.dish),
        dish_media: {
          ...src.dish_media,
          ...convertPrismaToSupabase_DishMedia(src.dish_media),
        },
        dish_reviews: src.dish_reviews.map((r) => ({
          ...r,
          ...convertPrismaToSupabase_DishReviews(r),
        })),
      })),
      nextCursor: result.nextCursor,
    };
  }

  /**
   * GET /v1/users/me/liked-dish-media のレスポンス変換
   */
  toMeLikedDishMediaResponse(result: {
    data: DishMediaEntryItem[];
    nextCursor: string | null;
  }): QueryMeLikedDishMediaResponse {
    return {
      data: result.data.map((src) => ({
        restaurant: convertPrismaToSupabase_Restaurants(src.restaurant),
        dish: convertPrismaToSupabase_Dishes(src.dish),
        dish_media: {
          ...src.dish_media,
          ...convertPrismaToSupabase_DishMedia(src.dish_media),
        },
        dish_reviews: src.dish_reviews.map((r) => ({
          ...r,
          ...convertPrismaToSupabase_DishReviews(r),
        })),
      })),
      nextCursor: result.nextCursor,
    };
  }

  /**
   * GET /v1/users/me/payouts のレスポンス変換
   */
  toMePayoutsResponse(result: {
    data: PrismaPayouts[];
    nextCursor: string | null;
  }): QueryMePayoutsResponse {
    return {
      data: result.data.map((p) => convertPrismaToSupabase_Payouts(p)),
      nextCursor: result.nextCursor,
    };
  }

  /**
   * GET /v1/users/me/restaurant-bids のレスポンス変換
   */
  toMeRestaurantBidsResponse(result: {
    data: PrismaRestaurantBids[];
    nextCursor: string | null;
  }): QueryMeRestaurantBidsResponse {
    return {
      data: result.data.map((b) => convertPrismaToSupabase_RestaurantBids(b)),
      nextCursor: result.nextCursor,
    };
  }

  /**
   * GET /v1/users/me/saved-dish-categories のレスポンス変換
   */
  toMeSavedDishCategoriesResponse(result: {
    data: PrismaDishCategories[];
    nextCursor: string | null;
  }): QueryMeSavedDishCategoriesResponse {
    return {
      data: result.data.map((src) =>
        convertPrismaToSupabase_DishCategories(src),
      ),
      nextCursor: result.nextCursor,
    };
  }

  /**
   * GET /v1/users/me/saved-dish-media のレスポンス変換
   */
  toMeSavedDishMediaResponse(result: {
    data: DishMediaEntryItem[];
    nextCursor: string | null;
  }): QueryMeSavedDishMediaResponse {
    return {
      data: result.data.map((src) => ({
        restaurant: convertPrismaToSupabase_Restaurants(src.restaurant),
        dish: convertPrismaToSupabase_Dishes(src.dish),
        dish_media: {
          ...src.dish_media,
          ...convertPrismaToSupabase_DishMedia(src.dish_media),
        },
        dish_reviews: src.dish_reviews.map((r) => ({
          ...r,
          ...convertPrismaToSupabase_DishReviews(r),
        })),
      })),
      nextCursor: result.nextCursor,
    };
  }
}
