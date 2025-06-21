/**
 * 👤 レビュー情報
 */
export interface Review {
  author: string;
  rating: number;
  text: string;
  translated: boolean;
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

/**
 * 🍽️ API レスポンスの 1 アイテム
 */
export interface DishMediaItem {
  dishId: string;
  dishName: string;
  category: string;
  photoUrl: string;
  rating: number;
  reviewCount: number;
  distanceMeters: number;
  place: PlaceInfo;
  reviews: Review[];
}

/**
 * listDishMedia のレスポンス全体
 */
export interface ListDishMediaResponse {
  items: DishMediaItem[];
  nextPageToken?: string;
}
