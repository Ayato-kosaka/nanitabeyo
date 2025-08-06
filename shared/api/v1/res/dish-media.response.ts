import { SupabaseRestaurants } from "../../../converters/convert_restaurants";
import { SupabaseDishes } from "../../../converters/convert_dishes";
import { SupabaseDishMedia } from "../../../converters/convert_dish_media";
import { SupabaseDishReviews } from "../../../converters/convert_dish_reviews";

/** GET /v1/dish-media のレスポンス型 */
export type QueryDishMediaResponse = {
	restaurant: SupabaseRestaurants;
	dish: SupabaseDishes;
	dish_media: SupabaseDishMedia;
	dish_reviews: SupabaseDishReviews[];
}[];

/** POST /v1/dish-media のレスポンス型 */
export type CreateDishMediaResponse = void;

/** POST /v1/dish-media/:id/likes/:userId のレスポンス型 */
export type LikeDishMediaResponse = void;

/** DELETE /v1/dish-media/:id/likes/:userId のレスポンス型 */
export type UnlikeDishMediaResponse = void;

/** POST /v1/dish-media/:id/save/:userId のレスポンス型 */
export type SaveDishMediaResponse = void;
