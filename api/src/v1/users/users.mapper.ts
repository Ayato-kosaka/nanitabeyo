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

@Injectable()
export class UsersMapper {
  /**
   * GET /v1/users/:id/dish-reviews のレスポンス変換
   */
  toUserDishReviewsResponse(items: any[]): QueryUserDishReviewsResponse {
    return items.map((item) => ({
      dish_media: item.dish_media,
      dish_review: item.dish_review,
      signedUrls: item.signedUrls,
      hasMedia: item.hasMedia,
    }));
  }

  /**
   * GET /v1/users/me/liked-dish-media のレスポンス変換
   */
  toMeLikedDishMediaResponse(items: any[]): QueryMeLikedDishMediaResponse {
    return items.map((item) => ({
      restaurant: item.restaurant,
      dish: item.dish,
      dish_media: item.dish_media,
      dish_reviews: item.dish_reviews,
    }));
  }

  /**
   * GET /v1/users/me/payouts のレスポンス変換
   */
  toMePayoutsResponse(items: any[]): QueryMePayoutsResponse {
    return items;
  }

  /**
   * GET /v1/users/me/restaurant-bids のレスポンス変換
   */
  toMeRestaurantBidsResponse(items: any[]): QueryMeRestaurantBidsResponse {
    return items;
  }

  /**
   * GET /v1/users/me/saved-dish-categories のレスポンス変換
   */
  toMeSavedDishCategoriesResponse(
    items: any[],
  ): QueryMeSavedDishCategoriesResponse {
    return items;
  }

  /**
   * GET /v1/users/me/saved-dish-media のレスポンス変換
   */
  toMeSavedDishMediaResponse(items: any[]): QueryMeSavedDishMediaResponse {
    return items.map((item) => ({
      restaurant: item.restaurant,
      dish: item.dish,
      dish_media: item.dish_media,
      dish_reviews: item.dish_reviews,
    }));
  }
}
