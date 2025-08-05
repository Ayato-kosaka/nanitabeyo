import { PrismaRestaurants } from "../../../converters/convert_restaurants";
import { PrismaDishes } from "../../../converters/convert_dishes";
import { PrismaDishMedia } from "../../../converters/convert_dish_media";
import { PrismaDishReviews } from "../../../converters/convert_dish_reviews";
import { PrismaRestaurantBids } from "../../../converters/convert_restaurant_bids";

/** GET /v1/restaurants のレスポンス型 */
export type QueryRestaurantsResponse = {
        restaurant: PrismaRestaurants;
        meta: { totalCents: number };
}[];

/** POST /v1/restaurants のレスポンス型 */
export type CreateRestaurantResponse = PrismaRestaurants;

/** POST /v1/restaurants/:id/bids/intents のレスポンス型 */
export type CreateRestaurantBidIntentResponse = { clientSecret: string };

/** GET /v1/restaurants/:id/dish-media のレスポンス型 */
export type QueryRestaurantDishMediaResponse = {
        restaurant: PrismaRestaurants;
        dish: PrismaDishes;
        dish_media: PrismaDishMedia;
        dish_reviews: PrismaDishReviews[];
}[];

/** GET /v1/restaurants/:id/restaurant-bids のレスポンス型 */
export type QueryRestaurantBidsResponse = PrismaRestaurantBids[];

/** GET /v1/restaurants/:id のレスポンス型 */
export type GetRestaurantResponse = PrismaRestaurants;
