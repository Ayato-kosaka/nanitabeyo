// api/src/v1/restaurants/restaurants.mapper.ts
//
// ❶ Repository から返ってきたデータを Response 型に変換
// ❷ nextCursor の計算など、レスポンス構造に関わるロジックを集約
//

import { Injectable } from '@nestjs/common';
import {
  QueryRestaurantsResponse,
  CreateRestaurantResponse,
  QueryRestaurantDishMediaResponse,
  QueryRestaurantBidsResponse,
  GetRestaurantResponse,
} from '@shared/v1/res';

import {
  RestaurantWithBidTotal,
  RestaurantDishMediaItem,
} from './restaurants.repository';
import { restaurants, restaurant_bids } from '../../../../shared/prisma/client';

@Injectable()
export class RestaurantsMapper {
  /* ------------------------------------------------------------------ */
  /*          GET /v1/restaurants のレスポンス変換                       */
  /* ------------------------------------------------------------------ */
  toQueryRestaurantsResponse(
    items: RestaurantWithBidTotal[],
  ): QueryRestaurantsResponse {
    return items.map((item) => ({
      restaurant: {
        id: item.restaurant.id,
        google_place_id: item.restaurant.google_place_id,
        name: item.restaurant.name,
        location: null, // TODO: Convert geography type
        image_url: item.restaurant.image_url,
        created_at: item.restaurant.created_at?.toISOString() ?? '',
      },
      meta: { totalCents: item.meta.totalCents },
    }));
  }

  /* ------------------------------------------------------------------ */
  /*          POST /v1/restaurants のレスポンス変換                      */
  /* ------------------------------------------------------------------ */
  toCreateRestaurantResponse(
    restaurant: restaurants,
  ): CreateRestaurantResponse {
    return {
      id: restaurant.id,
      google_place_id: restaurant.google_place_id,
      name: restaurant.name,
      location: null, // TODO: Convert geography type
      image_url: restaurant.image_url,
      created_at: restaurant.created_at?.toISOString() ?? '',
    };
  }

  /* ------------------------------------------------------------------ */
  /*          GET /v1/restaurants/:id のレスポンス変換                   */
  /* ------------------------------------------------------------------ */
  toGetRestaurantResponse(
    restaurant: restaurants,
  ): GetRestaurantResponse {
    return {
      id: restaurant.id,
      google_place_id: restaurant.google_place_id,
      name: restaurant.name,
      location: null, // TODO: Convert geography type
      image_url: restaurant.image_url,
      created_at: restaurant.created_at?.toISOString() ?? '',
    };
  }

  /* ------------------------------------------------------------------ */
  /*      GET /v1/restaurants/:id/dish-media のレスポンス変換            */
  /* ------------------------------------------------------------------ */
  toQueryRestaurantDishMediaResponse(
    items: RestaurantDishMediaItem[],
  ): QueryRestaurantDishMediaResponse {
    return items.map((item) => ({
      restaurant: {
        id: item.restaurant.id,
        google_place_id: item.restaurant.google_place_id,
        name: item.restaurant.name,
        location: null, // TODO: Convert geography type
        image_url: item.restaurant.image_url,
        created_at: item.restaurant.created_at?.toISOString() ?? '',
      },
      dish: {
        ...item.dish,
        created_at: item.dish.created_at?.toISOString() ?? '',
        updated_at: item.dish.updated_at?.toISOString() ?? '',
      },
      dish_media: {
        ...item.dish_media,
        created_at: item.dish_media.created_at?.toISOString() ?? '',
        updated_at: item.dish_media.updated_at?.toISOString() ?? '',
        lock_no: item.dish_media.lock_no ?? 0,
      },
      dish_reviews: (item.dish_reviews || []).map(review => ({
        ...review,
        created_at: review.created_at?.toISOString() ?? '',
      })),
    })) as QueryRestaurantDishMediaResponse;
  }

  /* ------------------------------------------------------------------ */
  /*   GET /v1/restaurants/:id/restaurant-bids のレスポンス変換           */
  /* ------------------------------------------------------------------ */
  toQueryRestaurantBidsResponse(
    bids: restaurant_bids[],
  ): QueryRestaurantBidsResponse {
    return bids.map(bid => ({
      id: bid.id,
      restaurant_id: bid.restaurant_id,
      user_id: bid.user_id,
      payment_intent_id: bid.payment_intent_id,
      amount_cents: Number(bid.amount_cents), // Convert bigint to number
      currency_code: bid.currency_code,
      start_date: bid.start_date?.toISOString() ?? '',
      end_date: bid.end_date?.toISOString() ?? '',
      status: bid.status as 'pending' | 'paid' | 'refunded',
      refund_id: bid.refund_id,
      created_at: bid.created_at?.toISOString() ?? '',
      updated_at: bid.updated_at?.toISOString() ?? '',
      lock_no: bid.lock_no,
    }));
  }
}
