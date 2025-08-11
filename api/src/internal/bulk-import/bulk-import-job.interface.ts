// api/src/internal/bulk-import/bulk-import-job.interface.ts
//
// Cloud Tasks で処理する非同期ジョブのペイロード定義
//

/**
 * Cloud Tasks で処理する bulk import ジョブのペイロード
 */
export interface BulkImportJobPayload {
  /** ジョブの一意識別子 */
  jobId: string;
  
  /** 冪等性キー（重複処理防止） */
  idempotencyKey: string;
  
  /** 取得すべき写真URI配列 */
  photoUris: string[];
  
  /** データベース登録用の完成済みデータ */
  restaurants: BulkImportRestaurantData[];
  dishes: BulkImportDishData[];
  dish_media: BulkImportDishMediaData[];
  dish_reviews: BulkImportDishReviewData[];
}

/**
 * レストランデータ
 */
export interface BulkImportRestaurantData {
  place_id: string;
  name: string;
  address: string | null;
  phone_number: string | null;
  website: string | null;
  price_level: number | null;
  rating: number | null;
  user_ratings_total: number | null;
  location_lat: number | null;
  location_lng: number | null;
  photo_uri: string | null;
  business_status: string | null;
  primary_type: string | null;
  opening_hours: string | null;
}

/**
 * 料理データ
 */
export interface BulkImportDishData {
  restaurant_place_id: string;
  category_id: string;
  name: string;
}

/**
 * 料理メディアデータ
 */
export interface BulkImportDishMediaData {
  restaurant_place_id: string;
  category_id: string;
  photo_uri: string;
  media_type: string;
}

/**
 * 料理レビューデータ
 */
export interface BulkImportDishReviewData {
  restaurant_place_id: string;
  category_id: string;
  rating: number;
  text: string | null;
  author_name: string | null;
  author_url: string | null;
  profile_photo_url: string | null;
  relative_time_description: string | null;
  time: number | null;
  original_language_code: string | null;
}