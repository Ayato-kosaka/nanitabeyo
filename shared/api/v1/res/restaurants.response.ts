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
export type CreateRestaurantResponse = {
	restaurant: RestaurantsEntity;
	meta: { reviewCount: number; averageRating: number; totalCents: number; maxEndDate: string | null };
};

/**
 * POST /v1/restaurants/draft のレスポンス型
 *
 * #1671 確認ページへ出す **Google 由来の既定値**と、それを封じた署名トークン。
 * まだ何も保存していない（店は「この内容で登録」を押すまで作られない）。
 */
export type CreateRestaurantDraftResponse = {
	draft: {
		googlePlaceId: string;
		/** 現地の言語での表示名。確認ページの店名欄の初期値 */
		name: string;
		nameLanguageCode: string;
		latitude: number;
		longitude: number;
		/** Google の addressComponents。確認ページは住所と国をここから組み立てる */
		addressComponents: unknown;
		/** addressComponents から解決した ISO 3166-1 alpha-2。判定できなければ null */
		countryCode: string | null;
	};
	/**
	 * POST /v1/restaurants へそのまま渡すトークン。
	 * ⚠️ 中身は署名済みで、クライアントが作り替えると作成が 400 になる。
	 */
	draftToken: string;
};

/** POST /v1/restaurants/:id/bids/intents のレスポンス型 */
export type CreateRestaurantBidIntentResponse = { clientSecret: string };

/** GET /v1/restaurants/:id/dish-media のレスポンス型 */
export type QueryRestaurantDishMediaResponse = PaginatedResponse<DishMediaEntry>;

/** GET /v1/restaurants/:id/restaurant-bids のレスポンス型 */
export type QueryRestaurantBidsResponse = SupabaseRestaurantBids[];

/** GET /v1/restaurants/by-google-place-id のレスポンス型 */
export type QueryRestaurantsByGooglePlaceIdResponse = RestaurantsEntity;

/** GET /v1/restaurants/:id のレスポンス型 */
export type GetRestaurantByIdResponse = {
	restaurant: RestaurantsEntity;
	meta: { reviewCount: number; averageRating: number; totalCents: number; maxEndDate: string | null };
};
