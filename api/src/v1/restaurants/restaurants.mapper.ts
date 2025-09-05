// api/src/v1/restaurants/restaurants.mapper.ts
//
// ❶ Mapper for restaurants domain - data transformation
// ❷ Following the pattern from dish-media/dish-media.mapper.ts
// ❸ Converts repository entities to response types

import { Injectable } from '@nestjs/common';
import { QueryRestaurantDishMediaResponse } from '@shared/v1/res';
import { convertPrismaToSupabase_Restaurants } from '../../../../shared/converters/convert_restaurants';
import { convertPrismaToSupabase_Dishes } from '../../../../shared/converters/convert_dishes';
import { convertPrismaToSupabase_DishMedia } from '../../../../shared/converters/convert_dish_media';
import { convertPrismaToSupabase_DishReviews } from '../../../../shared/converters/convert_dish_reviews';
import { DishMediaEntryItem } from '../dish-media/dish-media.mapper';

@Injectable()
export class RestaurantsMapper {
  /**
   * Repository から取得した `RestaurantDishMediaEntry[]` を
   * Controller が返す `QueryRestaurantDishMediaResponse` に整形する
   */
  toRestaurantDishMediaResponse(result: {
    data: DishMediaEntryItem[];
    nextCursor: string | null;
  }): QueryRestaurantDishMediaResponse {
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
