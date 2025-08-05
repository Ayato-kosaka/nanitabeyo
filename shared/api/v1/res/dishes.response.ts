import { PrismaRestaurants } from "../../../converters/convert_restaurants";
import { PrismaDishes } from "../../../converters/convert_dishes";
import { PrismaDishMedia } from "../../../converters/convert_dish_media";
import { PrismaDishReviews } from "../../../converters/convert_dish_reviews";

/** POST /v1/dishes のレスポンス型 */
export type CreateDishResponse = PrismaDishes;

/** POST /v1/dishes/bulk-import のレスポンス型 */
export type BulkImportDishesResponse = {
        restaurant: PrismaRestaurants;
        dish: PrismaDishes;
        dish_media: PrismaDishMedia;
        dish_reviews: PrismaDishReviews[];
}[];
