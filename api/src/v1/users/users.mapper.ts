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

@Injectable()
export class UsersMapper {
  /**
   * GET /v1/users/:id/dish-reviews のレスポンス変換
   */
  toUserDishReviewsResponse(result: {
    data: (DishMediaEntryItem & { dish_media: { isMe: boolean } })[],
    nextCursor: string | null;
  }
  ): QueryUserDishReviewsResponse {
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
  toMeLikedDishMediaResponse(result: any): QueryMeLikedDishMediaResponse {
    return {
      data: result.data,
      nextCursor: result.nextCursor,
    };
  }

  /**
   * GET /v1/users/me/payouts のレスポンス変換
   */
  toMePayoutsResponse(result: any): QueryMePayoutsResponse {
    return {
      data: result.data,
      nextCursor: result.nextCursor,
    };
  }

  /**
   * GET /v1/users/me/restaurant-bids のレスポンス変換
   */
  toMeRestaurantBidsResponse(result: any): QueryMeRestaurantBidsResponse {
    return {
      data: result.data,
      nextCursor: result.nextCursor,
    };
  }

  /**
   * GET /v1/users/me/saved-dish-categories のレスポンス変換
   */
  toMeSavedDishCategoriesResponse(
    result: any,
  ): QueryMeSavedDishCategoriesResponse {
    return {
      data: result.data,
      nextCursor: result.nextCursor,
    };
  }

  /**
   * GET /v1/users/me/saved-dish-media のレスポンス変換
   */
  toMeSavedDishMediaResponse(result: any): QueryMeSavedDishMediaResponse {
    return {
      data: result.data,
      nextCursor: result.nextCursor,
    };
  }
}
