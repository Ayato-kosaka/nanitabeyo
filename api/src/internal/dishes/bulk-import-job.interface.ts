// api/src/internal/dishes/bulk-import-job.interface.ts
//
// Cloud Tasks で処理する非同期ジョブのペイロード定義
//

import { Database } from '../../../../shared/supabase/database.types';

type SupabaseRestaurant = Database['dev']['Tables']['restaurants']['Row'];
type SupabaseDish = Database['dev']['Tables']['dishes']['Row'];
type SupabaseDishMedia = Database['dev']['Tables']['dish_media']['Row'];
type SupabaseDishReview = Database['dev']['Tables']['dish_reviews']['Row'];

/**
 * Cloud Tasks で処理する bulk import ジョブのペイロード
 */
export interface BulkImportJobPayload {
  /** ジョブの一意識別子 */
  jobId: string;

  /** 冪等性キー（重複処理防止） */
  idempotencyKey: string;

  /** 写真URI配列 */
  photoUri: string[];

  /** レストランデータ */
  restaurants: SupabaseRestaurant;

  /** 料理データ */
  dishes: SupabaseDish;

  /** 料理メディアデータ */
  dish_media: SupabaseDishMedia;

  /** 料理レビューデータ配列 */
  dish_reviews: SupabaseDishReview[];
}
