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
import { 
  convertPrismaToSupabase_Restaurants 
} from '../../../../shared/converters/convert_restaurants';
import { 
  convertPrismaToSupabase_RestaurantBids 
} from '../../../../shared/converters/convert_restaurant_bids';

@Injectable()
export class RestaurantsMapper {
  /* ------------------------------------------------------------------ */
  /*          GET /v1/restaurants のレスポンス変換                       */
  /* ------------------------------------------------------------------ */
  toQueryRestaurantsResponse(
    items: RestaurantWithBidTotal[],
  ): QueryRestaurantsResponse {
    return items.map((item) => ({
      restaurant: convertPrismaToSupabase_Restaurants(item.restaurant),
      meta: { totalCents: item.meta.totalCents },
    }));
  }

  /* ------------------------------------------------------------------ */
  /*          POST /v1/restaurants のレスポンス変換                      */
  /* ------------------------------------------------------------------ */
  toCreateRestaurantResponse(
    restaurant: restaurants,
  ): CreateRestaurantResponse {
    return convertPrismaToSupabase_Restaurants(restaurant);
  }

  /* ------------------------------------------------------------------ */
  /*          GET /v1/restaurants/:id のレスポンス変換                   */
  /* ------------------------------------------------------------------ */
  toGetRestaurantResponse(
    restaurant: restaurants,
  ): GetRestaurantResponse {
    return convertPrismaToSupabase_Restaurants(restaurant);
  }

  /* ------------------------------------------------------------------ */
  /*      GET /v1/restaurants/:id/dish-media のレスポンス変換            */
  /* ------------------------------------------------------------------ */
  toQueryRestaurantDishMediaResponse(
    items: RestaurantDishMediaItem[],
  ): QueryRestaurantDishMediaResponse {
    return items.map((item) => ({
      restaurant: convertPrismaToSupabase_Restaurants(item.restaurant),
      dish: item.dish,
      dish_media: item.dish_media,
      dish_reviews: item.dish_reviews || [],
    }));
  }

  /* ------------------------------------------------------------------ */
  /*   GET /v1/restaurants/:id/restaurant-bids のレスポンス変換           */
  /* ------------------------------------------------------------------ */
  toQueryRestaurantBidsResponse(
    bids: restaurant_bids[],
  ): QueryRestaurantBidsResponse {
    return bids.map(bid => convertPrismaToSupabase_RestaurantBids(bid));
  }
}
