import { SupabaseRestaurants } from "../../../converters/convert_restaurants";
import { SupabaseDishes } from "../../../converters/convert_dishes";
import { SupabaseDishMedia } from "../../../converters/convert_dish_media";
import { SupabaseDishReviews } from "../../../converters/convert_dish_reviews";
import { SupabaseRestaurantBids } from "../../../converters/convert_restaurant_bids";

/** GET /v1/restaurants のレスポンス型 */
export type QueryRestaurantsResponse = {
	restaurant: SupabaseRestaurants;
	meta: { totalCents: number };
}[];

/** POST /v1/restaurants のレスポンス型 */
export type CreateRestaurantResponse = SupabaseRestaurants;

/** POST /v1/restaurants/:id/bids/intents のレスポンス型 */
export type CreateRestaurantBidIntentResponse = { clientSecret: string };

/** GET /v1/restaurants/:id/dish-media のレスポンス型 */
export type QueryRestaurantDishMediaResponse = {
	restaurant: SupabaseRestaurants;
	dish: SupabaseDishes;
	dish_media: SupabaseDishMedia & { media_url?: string };
	dish_reviews: SupabaseDishReviews[];
}[];

/** GET /v1/restaurants/:id/restaurant-bids のレスポンス型 */
export type QueryRestaurantBidsResponse = SupabaseRestaurantBids[];

/** GET /v1/restaurants/:id のレスポンス型 */
export type GetRestaurantResponse = SupabaseRestaurants;
