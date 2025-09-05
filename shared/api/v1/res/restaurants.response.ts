import { SupabaseRestaurants } from "../../../converters/convert_restaurants";
import { SupabaseRestaurantBids } from "../../../converters/convert_restaurant_bids";
import { DishMediaEntry } from "./dish-media.response";
import { PaginatedResponse } from "./paginated-response";

/** GET /v1/restaurants/search のレスポンス型 */
export type QueryRestaurantsResponse = {
	restaurant: SupabaseRestaurants;
	meta: { totalCents: number; maxEndDate: string | null };
}[];

/** POST /v1/restaurants のレスポンス型 */
export type CreateRestaurantResponse = SupabaseRestaurants & {
	reviewCount: number;
	averageRating: number;
};

/** POST /v1/restaurants/:id/bids/intents のレスポンス型 */
export type CreateRestaurantBidIntentResponse = { clientSecret: string };

/** GET /v1/restaurants/:id/dish-media のレスポンス型 */
export type QueryRestaurantDishMediaResponse = PaginatedResponse<
	DishMediaEntry & {
		dish: {
			reviewCount: number;
			averageRating: number;
		};
	}
>;

/** GET /v1/restaurants/:id/restaurant-bids のレスポンス型 */
export type QueryRestaurantBidsResponse = SupabaseRestaurantBids[];

/** GET /v1/restaurants/by-google-place-id のレスポンス型 */
export type QueryRestaurantsByGooglePlaceIdResponse = SupabaseRestaurants;
