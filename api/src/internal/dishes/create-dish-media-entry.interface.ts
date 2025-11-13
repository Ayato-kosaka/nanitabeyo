// api/src/internal/dishes/create-dish-media-entry.interface.ts
//
// Cloud Tasks で処理する非同期ジョブのペイロード定義
//

import { SupabaseDishMedia } from '../../../../shared/converters/convert_dish_media';
import { SupabaseDishReviews } from '../../../../shared/converters/convert_dish_reviews';
import { SupabaseDishes } from '../../../../shared/converters/convert_dishes';
import { SupabaseRestaurants } from '../../../../shared/converters/convert_restaurants';

/**
 * Cloud Tasks で処理する createDishMediaEntry ジョブのペイロード
 */
export interface CreateDishMediaEntryJobPayload {
  /** ジョブの一意識別子 */
  jobId: string;

  /** 冪等性キー（重複処理防止） */
  idempotencyKey: string;

  /** 写真URI配列 */
  photoUri: string[];

  /** レストランデータ */
  restaurants: SupabaseRestaurants;

  /** 料理データ */
  dishes: SupabaseDishes;

  /** 料理メディアデータ */
  dish_media: SupabaseDishMedia;

  /** 料理レビューデータ配列 */
  dish_reviews: SupabaseDishReviews[];
}
