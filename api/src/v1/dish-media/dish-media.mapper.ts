// food-app/api/src/v1/dish-media/dish-media.mapper.ts
//
// ❶ Repository → Controller 公開型（SearchDishMediaResponse）へ変換
// ❷ Prisma → Supabase 型は shared/converters のユーティリティを reuse
//

import { Injectable } from '@nestjs/common';

import { DishMediaEntryEntity } from './dish-media.repository';
import { SearchDishMediaResponse } from '@shared/v1/res';

import { convertPrismaToSupabase_Restaurants } from '../../../../shared/converters/convert_restaurants';
import { convertPrismaToSupabase_Dishes } from '../../../../shared/converters/convert_dishes';
import { convertPrismaToSupabase_DishMedia } from '../../../../shared/converters/convert_dish_media';
import { convertPrismaToSupabase_DishReviews } from '../../../../shared/converters/convert_dish_reviews';

export type DishMediaEntryItem = DishMediaEntryEntity & {
  dish_media: {
    mediaUrl: string;
    thumbnailImageUrl: string;
  };
};

@Injectable()
export class DishMediaMapper {
  /**
   * Repository から取得した `DishMediaEntryEntity[]` を
   * Controller が返す `SearchDishMediaResponse` に整形する
   */
  toSearchDishMediaResponse(
    items: DishMediaEntryItem[],
  ): SearchDishMediaResponse {
    return items.map((src) => {
      // Use convertPrismaToSupabase as base, then add only required additional fields
      const restaurant = convertPrismaToSupabase_Restaurants(src.restaurant);

      const dishBase = convertPrismaToSupabase_Dishes(src.dish);
      const dish = {
        ...dishBase,
        // Explicitly add only the required additional fields for DishMediaEntry.dish
        reviewCount: src.dish.reviewCount,
        averageRating: src.dish.averageRating,
      };

      const dishMediaBase = convertPrismaToSupabase_DishMedia(src.dish_media);
      const dish_media = {
        ...dishMediaBase,
        // Explicitly add only the required additional fields for DishMediaEntry.dish_media
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
          // Explicitly add only the required additional fields for DishMediaEntry.dish_reviews
          username: r.username,
          isLiked: r.isLiked,
          likeCount: r.likeCount,
        };
      });

      return { restaurant, dish, dish_media, dish_reviews };
    });
  }
}
