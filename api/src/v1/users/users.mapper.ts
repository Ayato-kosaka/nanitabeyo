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
      data: result.data.map((src) => {
        const restaurant = convertPrismaToSupabase_Restaurants(src.restaurant);

        const dishBase = convertPrismaToSupabase_Dishes(src.dish);
        const dish = {
          ...dishBase,
          // Explicitly add only the required additional fields
          reviewCount: src.dish.reviewCount,
          averageRating: src.dish.averageRating,
        };

        const dishMediaBase = convertPrismaToSupabase_DishMedia(src.dish_media);
        const dish_media = {
          ...dishMediaBase,
          // Explicitly add only the required additional fields
          isSaved: src.dish_media.isSaved,
          isLiked: src.dish_media.isLiked,
          likeCount: src.dish_media.likeCount,
          mediaUrl: src.dish_media.mediaUrl,
          thumbnailImageUrl: src.dish_media.thumbnailImageUrl,
          // This specific endpoint includes isMe field
          isMe: src.dish_media.isMe,
        };

        const dish_reviews = src.dish_reviews.map((r) => {
          const reviewBase = convertPrismaToSupabase_DishReviews(r);
          return {
            ...reviewBase,
            // Explicitly add only the required additional fields
            username: r.username,
            isLiked: r.isLiked,
            likeCount: r.likeCount,
          };
        });

        return { restaurant, dish, dish_media, dish_reviews };
      }),
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
      data: result.data.map((src) => {
        const restaurant = convertPrismaToSupabase_Restaurants(src.restaurant);

        const dishBase = convertPrismaToSupabase_Dishes(src.dish);
        const dish = {
          ...dishBase,
          // Explicitly add only the required additional fields
          reviewCount: src.dish.reviewCount,
          averageRating: src.dish.averageRating,
        };

        const dishMediaBase = convertPrismaToSupabase_DishMedia(src.dish_media);
        const dish_media = {
          ...dishMediaBase,
          // Explicitly add only the required additional fields
          isSaved: src.dish_media.isSaved,
          isLiked: src.dish_media.isLiked,
          likeCount: src.dish_media.likeCount,
          mediaUrl: src.dish_media.mediaUrl,
          thumbnailImageUrl: src.dish_media.thumbnailImageUrl,
        };

        const dish_reviews = src.dish_reviews.map((r) => {
          const reviewBase = convertPrismaToSupabase_DishReviews(r);
          return {
            ...reviewBase,
            // Explicitly add only the required additional fields
            username: r.username,
            isLiked: r.isLiked,
            likeCount: r.likeCount,
          };
        });

        return { restaurant, dish, dish_media, dish_reviews };
      }),
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
      data: result.data.map((src) => {
        const restaurant = convertPrismaToSupabase_Restaurants(src.restaurant);

        const dishBase = convertPrismaToSupabase_Dishes(src.dish);
        const dish = {
          ...dishBase,
          // Explicitly add only the required additional fields
          reviewCount: src.dish.reviewCount,
          averageRating: src.dish.averageRating,
        };

        const dishMediaBase = convertPrismaToSupabase_DishMedia(src.dish_media);
        const dish_media = {
          ...dishMediaBase,
          // Explicitly add only the required additional fields
          isSaved: src.dish_media.isSaved,
          isLiked: src.dish_media.isLiked,
          likeCount: src.dish_media.likeCount,
          mediaUrl: src.dish_media.mediaUrl,
          thumbnailImageUrl: src.dish_media.thumbnailImageUrl,
        };

        const dish_reviews = src.dish_reviews.map((r) => {
          const reviewBase = convertPrismaToSupabase_DishReviews(r);
          return {
            ...reviewBase,
            // Explicitly add only the required additional fields
            username: r.username,
            isLiked: r.isLiked,
            likeCount: r.likeCount,
          };
        });

        return { restaurant, dish, dish_media, dish_reviews };
      }),
      nextCursor: result.nextCursor,
    };
  }
}
