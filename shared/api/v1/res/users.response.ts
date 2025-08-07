import { SupabaseDishMedia } from "../../../converters/convert_dish_media";
import { SupabaseDishReviews } from "../../../converters/convert_dish_reviews";
import { SupabaseRestaurants } from "../../../converters/convert_restaurants";
import { SupabaseDishes } from "../../../converters/convert_dishes";
import { SupabasePayouts } from "../../../converters/convert_payouts";
import { SupabaseRestaurantBids } from "../../../converters/convert_restaurant_bids";
import { SupabaseDishCategories } from "../../../converters/convert_dish_categories";

/** GET /v1/users/:id/dish-reviews のレスポンス型 */
export type QueryUserDishReviewsResponse = {
	dish_media: SupabaseDishMedia | null;
	dish_review: SupabaseDishReviews;
	signedUrls: string[];
	hasMedia: boolean;
}[];

/** GET /v1/users/me/liked-dish-media のレスポンス型 */
export type QueryMeLikedDishMediaResponse = {
	restaurant: SupabaseRestaurants;
	dish: SupabaseDishes;
	dish_media: SupabaseDishMedia;
	dish_reviews: SupabaseDishReviews[];
}[];

/** GET /v1/users/me/payouts のレスポンス型 */
export type QueryMePayoutsResponse = SupabasePayouts[];

/** GET /v1/users/me/restaurant-bids のレスポンス型 */
export type QueryMeRestaurantBidsResponse = SupabaseRestaurantBids[];

/** GET /v1/users/me/saved-dish-categories のレスポンス型 */
export type QueryMeSavedDishCategoriesResponse = SupabaseDishCategories[];

/** GET /v1/users/me/saved-dish-media のレスポンス型 */
export type QueryMeSavedDishMediaResponse = {
	restaurant: SupabaseRestaurants;
	dish: SupabaseDishes;
	dish_media: SupabaseDishMedia;
	dish_reviews: SupabaseDishReviews[];
}[];
