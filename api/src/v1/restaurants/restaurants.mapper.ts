// api/src/v1/restaurants/restaurants.mapper.ts
//
// ❶ Mapper for restaurants domain - data transformation
// ❷ Following the pattern from dish-media/dish-media.mapper.ts
// ❸ Converts repository entities to response types

import { Injectable } from '@nestjs/common';
import { QueryRestaurantDishMediaResponse } from '@shared/v1/res';
import { RestaurantDishMediaEntry } from './restaurants.repository';
import { convertPrismaToSupabase_Restaurants } from '../../../../shared/converters/convert_restaurants';
import { convertPrismaToSupabase_Dishes } from '../../../../shared/converters/convert_dishes';
import { convertPrismaToSupabase_DishMedia } from '../../../../shared/converters/convert_dish_media';
import { convertPrismaToSupabase_DishReviews } from '../../../../shared/converters/convert_dish_reviews';

@Injectable()
export class RestaurantsMapper {
  /**
   * Repository から取得した `RestaurantDishMediaEntry[]` を
   * Controller が返す `QueryRestaurantDishMediaResponse` に整形する
   */
  toRestaurantDishMediaResponse(
    items: RestaurantDishMediaEntry[],
    viewerId?: string,
  ): QueryRestaurantDishMediaResponse {
    const data = items
      .filter((src) => src.dish_media.length > 0) // dish_mediaが存在するもののみ
      .map((src) => {
        // レストラン情報
        const restaurant = convertPrismaToSupabase_Restaurants(src.dishes.restaurants);

        // 料理情報
        const dish = {
          ...convertPrismaToSupabase_Dishes({
            id: src.id,
            created_at: new Date(),
            updated_at: new Date(),
            lock_no: 0,
            restaurant_id: src.dishes.restaurants.id,
            category_id: src.dishes.dish_categories.id,
            name: null,
          }),
          reviewCount: src.dish_reviews.length,
          averageRating: src.dish_reviews.length > 0
            ? src.dish_reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / src.dish_reviews.length
            : 0,
        };

        // 料理メディア情報 (最新の1件)
        const latestDishMedia = src.dish_media[0];
        const dish_media = {
          ...convertPrismaToSupabase_DishMedia(latestDishMedia),
          // 追加のフィールド
          isSaved: false, // saving機能が実装されていない場合はfalse
          isLiked: viewerId
            ? latestDishMedia.dish_media_likes?.some((like: any) => like.user_id === viewerId) || false
            : false,
          likeCount: latestDishMedia.dish_media_likes?.length || 0,
          mediaUrl: this.generateMediaUrl(latestDishMedia.media_path),
          thumbnailImageUrl: this.generateThumbnailUrl(latestDishMedia.media_path),
        };

        // レビュー情報
        const dish_reviews = src.dish_reviews.map((review) => {
          const reviewBase = convertPrismaToSupabase_DishReviews(review);
          return {
            ...reviewBase,
            // 追加のフィールド
            username: review.users?.username || review.imported_user_name || 'Anonymous',
            isLiked: false, // review likes機能が実装されていない場合はfalse
            likeCount: 0, // review likes機能が実装されていない場合は0
          };
        });

        return {
          restaurant,
          dish,
          dish_media,
          dish_reviews,
        };
      });

    // ページネーション処理（簡単な実装）
    const hasMore = data.length > 40;
    const finalData = hasMore ? data.slice(0, 40) : data;
    const nextCursor = hasMore ? `cursor_${Date.now()}` : null;

    return {
      data: finalData,
      nextCursor,
    };
  }

  /**
   * メディアパスから完全なURLを生成
   */
  private generateMediaUrl(mediaPath: string): string {
    if (!mediaPath) return '';
    // GCS URL生成 - 実際の実装では StorageService を使用
    return `https://storage.googleapis.com/your-bucket/${mediaPath}`;
  }

  /**
   * メディアパスからサムネイルURLを生成
   */
  private generateThumbnailUrl(mediaPath: string): string {
    if (!mediaPath) return '';
    // サムネイル URL生成 - 実際の実装では StorageService を使用
    return `https://storage.googleapis.com/your-bucket/thumbnails/${mediaPath}`;
  }
}