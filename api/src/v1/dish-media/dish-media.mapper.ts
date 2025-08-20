// food-app/api/src/v1/dish-media/dish-media.mapper.ts
//
// ❶ Repository → Controller 公開型（QueryDishMediaResponse）へ変換
// ❷ Prisma → Supabase 型は shared/converters のユーティリティを reuse
//

import { Injectable } from '@nestjs/common';

import { DishMediaEntryEntity } from './dish-media.repository';
import { QueryDishMediaResponse } from '@shared/v1/res';

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
   * Controller が返す `QueryDishMediaResponse` に整形する
   */
  toQueryDishMediaResponse(
    items: DishMediaEntryItem[],
  ): QueryDishMediaResponse {
    return items.map((src) => ({
      restaurant: convertPrismaToSupabase_Restaurants(src.restaurant),
      dish: {
        ...src.dish,
        ...convertPrismaToSupabase_Dishes(src.dish),
      },
      dish_media: {
        ...src.dish_media,
        ...convertPrismaToSupabase_DishMedia(src.dish_media),
      },
      dish_reviews: src.dish_reviews.map((r) => ({
        ...r,
        ...convertPrismaToSupabase_DishReviews(r),
      })),
    }));
  }
}
