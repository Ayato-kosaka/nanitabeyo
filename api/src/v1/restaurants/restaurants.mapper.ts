// api/src/v1/restaurants/restaurants.mapper.ts
//
// ❶ Repository から返されるデータを Response 型へ変換
// ❂ ViewModel を作成し、Frontend が使いやすい形に整形
// ❸ paginated response のメタデータ算出
//

import { Injectable } from '@nestjs/common';

import {
  QueryRestaurantsResponse,
  CreateRestaurantResponse,
  CreateRestaurantBidIntentResponse,
  QueryRestaurantDishMediaResponse,
  QueryRestaurantBidsResponse,
  GetRestaurantResponse,
} from '@shared/v1/res';

import { convertPrismaToSupabase_Restaurants } from '../../../../shared/converters/convert_restaurants';
import { convertPrismaToSupabase_RestaurantBids } from '../../../../shared/converters/convert_restaurant_bids';
import { convertPrismaToSupabase_Dishes } from '../../../../shared/converters/convert_dishes';
import { convertPrismaToSupabase_DishMedia } from '../../../../shared/converters/convert_dish_media';
import { convertPrismaToSupabase_DishReviews } from '../../../../shared/converters/convert_dish_reviews';

@Injectable()
export class RestaurantsMapper {
  /* ------------------------------------------------------------------ */
  /*                GET /v1/restaurants Response Mapping               */
  /* ------------------------------------------------------------------ */
  toQueryResponse(items: any[]): {
    data: QueryRestaurantsResponse;
    nextCursor?: string;
  } {
    const hasMore = items.length > 40;
    const data = (hasMore ? items.slice(0, 40) : items).map((item) => ({
      restaurant: {
        id: item.id,
        google_place_id: item.google_place_id,
        name: item.name,
        location: null, // Will be converted properly if needed
        image_url: item.image_url,
        created_at: item.created_at?.toISOString?.() ?? item.created_at,
      },
      meta: {
        totalCents: Number(item.total_cents) || 0,
      },
    }));

    return {
      data,
      nextCursor: hasMore ? items[39]?.id : undefined,
    };
  }

  /* ------------------------------------------------------------------ */
  /*                POST /v1/restaurants Response Mapping              */
  /* ------------------------------------------------------------------ */
  toCreateResponse(restaurant: any): CreateRestaurantResponse {
    return convertPrismaToSupabase_Restaurants(restaurant);
  }

  /* ------------------------------------------------------------------ */
  /*          POST /v1/restaurants/:id/bids/intents Response Mapping   */
  /* ------------------------------------------------------------------ */
  toBidIntentResponse(clientSecret: string): CreateRestaurantBidIntentResponse {
    return { clientSecret };
  }

  /* ------------------------------------------------------------------ */
  /*           GET /v1/restaurants/:id/dish-media Response Mapping     */
  /* ------------------------------------------------------------------ */
  toDishMediaResponse(items: any[]): {
    data: QueryRestaurantDishMediaResponse;
    nextCursor?: string;
  } {
    const hasMore = items.length > 40;
    const data = (hasMore ? items.slice(0, 40) : items).map((item) => ({
      restaurant: convertPrismaToSupabase_Restaurants({
        id: item.id,
        google_place_id: item.google_place_id,
        name: item.name,
        image_url: item.image_url,
        created_at: item.created_at,
      }),
      dish: convertPrismaToSupabase_Dishes({
        id: item.dish_id,
        restaurant_id: item.restaurant_id,
        category_id: item.category_id,
        name: item.dish_name,
        created_at: item.dish_created_at,
        updated_at: item.dish_updated_at,
        lock_no: item.dish_lock_no,
      }),
      dish_media: convertPrismaToSupabase_DishMedia({
        id: item.dish_media_id,
        dish_id: item.dish_id,
        user_id: item.user_id,
        media_path: item.media_path,
        media_type: item.media_type,
        thumbnail_path: item.thumbnail_path,
        created_at: item.dish_media_created_at,
        updated_at: item.dish_media_updated_at,
        lock_no: item.dish_media_lock_no,
      }),
      dish_reviews: Array.isArray(item.dish_reviews)
        ? item.dish_reviews.map((review: any) =>
            convertPrismaToSupabase_DishReviews(review),
          )
        : [],
    }));

    return {
      data,
      nextCursor: hasMore ? items[39]?.dish_media_id : undefined,
    };
  }

  /* ------------------------------------------------------------------ */
  /*          GET /v1/restaurants/:id/restaurant-bids Response Mapping */
  /* ------------------------------------------------------------------ */
  toRestaurantBidsResponse(items: any[]): {
    data: QueryRestaurantBidsResponse;
    nextCursor?: string;
  } {
    const hasMore = items.length > 40;
    const data = (hasMore ? items.slice(0, 40) : items).map((item) =>
      convertPrismaToSupabase_RestaurantBids(item),
    );

    return {
      data,
      nextCursor: hasMore ? items[39]?.id : undefined,
    };
  }

  /* ------------------------------------------------------------------ */
  /*                GET /v1/restaurants/:id Response Mapping           */
  /* ------------------------------------------------------------------ */
  toGetResponse(restaurant: any): GetRestaurantResponse {
    return convertPrismaToSupabase_Restaurants(restaurant);
  }
}
