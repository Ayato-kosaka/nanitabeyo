import { SupabasePayouts } from "../../../converters/convert_payouts";
import { SupabaseRestaurantBids } from "../../../converters/convert_restaurant_bids";
import { SupabaseDishCategories } from "../../../converters/convert_dish_categories";
import { PaginatedResponse } from "./paginated-response";
import { DishMediaEntry } from "./dish-media.response";
import { SupabaseUsers } from "shared/converters/convert_users";

/**
 * ユーザープロフィール情報
 */
export type UserProfile = SupabaseUsers & {
	/** アバター画像の署名付きURL（原本） */
	avatarSignedUrl?: string;
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
