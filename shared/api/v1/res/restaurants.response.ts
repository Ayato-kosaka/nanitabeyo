import { SupabaseRestaurants } from "../../../converters/convert_restaurants";
import { SupabaseRestaurantBids } from "../../../converters/convert_restaurant_bids";
import { DishMediaEntry } from "./dish-media.response";
import { PaginatedResponse } from "./paginated-response";

export type RestaurantsEntity = SupabaseRestaurants & {
	// @deprecated image_url は非推奨。代わりに imageUrls を使うこと。
	image_url: string;
	/** レストラン画像の署名付きCDN URL群（派生サイズ） */
	imageUrls?: {
		sm: string; // 64x64
		md: string; // 256x256
	};
};

/** GET /v1/restaurants/search のレスポンス型 */
export type QueryRestaurantsResponse = {
	restaurant: RestaurantsEntity;
	meta: { reviewCount: number; averageRating: number; totalCents: number; maxEndDate: string | null };
}[];

/** POST /v1/restaurants のレスポンス型 */
export type CreateRestaurantResponse = RestaurantsEntity & {
	reviewCount: number;
	averageRating: number;
	totalCents: number;
	maxEndDate: string | null;
};

/** POST /v1/restaurants/:id/bids/intents のレスポンス型 */
export type CreateRestaurantBidIntentResponse = { clientSecret: string };

/** GET /v1/restaurants/:id/dish-media のレスポンス型 */
export type QueryRestaurantDishMediaResponse = PaginatedResponse<DishMediaEntry>;

/** GET /v1/restaurants/:id/restaurant-bids のレスポンス型 */
export type QueryRestaurantBidsResponse = SupabaseRestaurantBids[];

/** GET /v1/restaurants/by-google-place-id のレスポンス型 */
export type QueryRestaurantsByGooglePlaceIdResponse = RestaurantsEntity;
