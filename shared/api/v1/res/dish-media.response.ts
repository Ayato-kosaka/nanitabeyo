import { PrismaRestaurants } from "../../../converters/convert_restaurants";
import { PrismaDishes } from "../../../converters/convert_dishes";
import { PrismaDishMedia } from "../../../converters/convert_dish_media";
import { PrismaDishReviews } from "../../../converters/convert_dish_reviews";

/** GET /v1/dish-media のレスポンス型 */
export type QueryDishMediaResponse = {
	restaurant: PrismaRestaurants;
	dish: PrismaDishes;
	dish_media: PrismaDishMedia;
	dish_reviews: PrismaDishReviews[];
}[];

/** POST /v1/dish-media のレスポンス型 */
export type CreateDishMediaResponse = void;

/** POST /v1/dish-media/:id/likes/:userId のレスポンス型 */
export type LikeDishMediaResponse = void;

/** DELETE /v1/dish-media/:id/likes/:userId のレスポンス型 */
export type UnlikeDishMediaResponse = void;

/** POST /v1/dish-media/:id/save/:userId のレスポンス型 */
export type SaveDishMediaResponse = void;
