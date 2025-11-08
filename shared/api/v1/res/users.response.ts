import { SupabasePayouts } from "../../../converters/convert_payouts";
import { SupabaseRestaurantBids } from "../../../converters/convert_restaurant_bids";
import { SupabaseDishCategories } from "../../../converters/convert_dish_categories";
import { PaginatedResponse } from "./paginated-response";
import { DishMediaEntry } from "./dish-media.response";

/**
 * ユーザープロフィール情報
 */
export interface UserProfile {
	id: string;
	username: string;
	display_name: string | null;
	bio: string | null;
	avatar: string | null;
	avatar_path: string | null;
	preferred_locale: string;
	created_at: string;
	updated_at: string;
	/** アバター画像の署名付きURL（原本） */
	avatarUrl?: string;
	/** アバター画像のCDN URL（利用可能な場合） */
	avatarCdnUrl?: string;
	/** アバター画像の派生サイズURL群 */
	avatarUrls?: {
		sm?: string; // 64x64
		md?: string; // 256x256
		lg?: string; // 512x512
	};
}

/** GET /v1/users/:id/dish-reviews のレスポンス型 */
export type QueryUserDishReviewsResponse = PaginatedResponse<
	DishMediaEntry & {
		dish: {
			reviewCount: number;
			averageRating: number;
		};
		dish_media: { isMe: boolean };
	}
>;

/** GET /v1/users/me/liked-dish-media のレスポンス型 */
export type QueryMeLikedDishMediaResponse = PaginatedResponse<
	DishMediaEntry & {
		dish: {
			reviewCount: number;
			averageRating: number;
		};
	}
>;

/** GET /v1/users/me/payouts のレスポンス型 */
export type QueryMePayoutsResponse = PaginatedResponse<SupabasePayouts>;

/** GET /v1/users/me/restaurant-bids のレスポンス型 */
export type QueryMeRestaurantBidsResponse = PaginatedResponse<SupabaseRestaurantBids>;

/** GET /v1/users/me/saved-dish-categories のレスポンス型 */
export type QueryMeSavedDishCategoriesResponse = PaginatedResponse<SupabaseDishCategories>;

/** GET /v1/users/me/saved-dish-media のレスポンス型 */
export type QueryMeSavedDishMediaResponse = PaginatedResponse<
	DishMediaEntry & {
		dish: {
			reviewCount: number;
			averageRating: number;
		};
	}
>;

/** GET /v1/users/:id のレスポンス型 */
export type GetUserProfileResponse = UserProfile;

/** POST /v1/users/:id のレスポンス型 */
export type UpdateUserProfileResponse = UserProfile;
