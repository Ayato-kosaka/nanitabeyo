import { z } from 'zod';

/**
 * 🍽️ listDishMedia クエリのバリデーションスキーマ
 * - 必須項目や範囲制約を zod で定義する
 */
export const listDishMediaQuerySchema = z.object({
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  radius: z.coerce.number().int().min(1).max(5000).default(1000),
  limit: z.coerce.number().int().min(1).max(40).default(20),
  lang: z.string().default('ja'),
  category: z.string().optional(),
});

/**
 * listDishMedia クエリの型定義
 */
export type ListDishMediaQuery = z.infer<typeof listDishMediaQuerySchema>;


/**
 * listDishMedia API のレスポンス型
 * 
 */
export type ListDishMediaResponse = DishMedia[];


/**
 * 🍽️ API レスポンスの 1 アイテム
 */
export interface DishMedia {
  id: string;
  dish_name: string;
  category: string;
  photo_url: string;
  average_rating: number;
  review_count: number;
  // distanceMeters: number;
  price: number;
  place: PlaceInfo;
  reviews: Review[];
}

/**
 * 👤 レビュー情報
 */
export interface Review {
  id: string;
  author_name: string;
  user_avatar?: string;
  rating: number;
  text: string;
  translated: boolean;
  created_at?: string;
  helpful_count: number;
}

/**
 * 📍 店舗情報（ナビ・予約連携用）
 */
export interface PlaceInfo {
  placeId: string;
  name: string;
  vicinity: string;
  location: { lat: number; lng: number };
  googleMapUrl: string;
}