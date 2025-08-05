import { PrismaDishMedia } from "../../../converters/convert_dish_media";
import { PrismaDishReviews } from "../../../converters/convert_dish_reviews";
import { PrismaRestaurants } from "../../../converters/convert_restaurants";
import { PrismaDishes } from "../../../converters/convert_dishes";
import { PrismaPayouts } from "../../../converters/convert_payouts";
import { PrismaRestaurantBids } from "../../../converters/convert_restaurant_bids";
import { PrismaDishCategories } from "../../../converters/convert_dish_categories";

/** GET /v1/users/:id/dish-reviews のレスポンス型 */
export type QueryUserDishReviewsResponse = {
        dish_media: PrismaDishMedia;
        dish_review: PrismaDishReviews;
        signedUrls: string[];
        hasMedia: boolean;
}[];

/** GET /v1/users/me/liked-dish-media のレスポンス型 */
export type QueryMeLikedDishMediaResponse = {
        restaurant: PrismaRestaurants;
        dish: PrismaDishes;
        dish_media: PrismaDishMedia;
        dish_reviews: PrismaDishReviews[];
}[];

/** GET /v1/users/me/payouts のレスポンス型 */
export type QueryMePayoutsResponse = PrismaPayouts[];

/** GET /v1/users/me/restaurant-bids のレスポンス型 */
export type QueryMeRestaurantBidsResponse = PrismaRestaurantBids[];

/** GET /v1/users/me/saved-dish-categories のレスポンス型 */
export type QueryMeSavedDishCategoriesResponse = PrismaDishCategories[];

/** GET /v1/users/me/saved-dish-media のレスポンス型 */
export type QueryMeSavedDishMediaResponse = {
        restaurant: PrismaRestaurants;
        dish: PrismaDishes;
        dish_media: PrismaDishMedia;
        dish_reviews: PrismaDishReviews[];
}[];
