import { SupabasePayouts } from "../../../converters/convert_payouts";
import { SupabaseRestaurantBids } from "../../../converters/convert_restaurant_bids";
import { SupabaseDishCategories } from "../../../converters/convert_dish_categories";
import { PaginatedResponse } from "./paginated-response";
import { DishMediaEntry } from "./dish-media.response";
import { SupabaseUsers } from "../../../converters/convert_users";
import { RestaurantsEntity } from "./restaurants.response";

/**
 * ユーザープロフィール情報
 */
export type UserProfile = SupabaseUsers & {
	avatarUrls?: {
		sm: string; // 64x64
		md: string; // 256x256
	};
};

/** GET /v1/users/:id/dish-reviews のレスポンス型 */
export type QueryUserDishReviewsResponse = PaginatedResponse<DishMediaEntry>;

/** GET /v1/users/me/liked-dish-media のレスポンス型 */
export type QueryMeLikedDishMediaResponse = PaginatedResponse<DishMediaEntry>;

/** GET /v1/users/me/payouts のレスポンス型 */
export type QueryMePayoutsResponse = PaginatedResponse<SupabasePayouts>;

/** GET /v1/users/me/restaurant-bids のレスポンス型 */
export type QueryMeRestaurantBidsResponse = PaginatedResponse<SupabaseRestaurantBids>;

/** GET /v1/users/me/saved-dish-categories のレスポンス型 */
export type QueryMeSavedDishCategoriesResponse = PaginatedResponse<SupabaseDishCategories>;

/** GET /v1/users/me/blocked-dish-categories のレスポンス型 */
export type QueryMeBlockedDishCategoriesResponse = PaginatedResponse<SupabaseDishCategories>;

/** GET /v1/users/me/saved-dish-media のレスポンス型 */
export type QueryMeSavedDishMediaResponse = PaginatedResponse<DishMediaEntry>;

/** GET /v1/users/me/saved-restaurants のレスポンス型 */
export type QueryMeSavedRestaurantsResponse = PaginatedResponse<{
	restaurant: RestaurantsEntity;
	meta: {
		reviewCount: number;
		averageRating: number;
		lastSavedAt: string | null;
	};
}>;

/** GET /v1/users/:id のレスポンス型 */
export type GetUserProfileResponse = UserProfile;

/** POST /v1/users/me のレスポンス型 */
export type UpdateUserProfileResponse = UserProfile;

/**
 * DELETE /v1/users/me のレスポンス型（#1511 ACC-01 アカウント削除）
 *
 * `deletedAt` は users.deleted_at に立てた時刻（ISO8601）。
 * 削除は取り消せないため「予約した時刻」ではなく「実行した時刻」である。
 */
export type DeleteMeResponse = {
	success: boolean;
	deletedAt: string;
};

/** DELETE /v1/users/me/blocked-dish-categories/:categoryId のレスポンス型 */
export type UnblockDishCategoryResponse = {
	success: boolean;
	message: string;
};
