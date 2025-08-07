import { SupabaseRestaurants } from "../../../converters/convert_restaurants";
import { SupabaseDishes } from "../../../converters/convert_dishes";
import { SupabaseDishMedia } from "../../../converters/convert_dish_media";
import { SupabaseDishReviews } from "../../../converters/convert_dish_reviews";

/** POST /v1/dishes のレスポンス型 */
export type CreateDishResponse = SupabaseDishes;

/** POST /v1/dishes/bulk-import のレスポンス型 */
export type BulkImportDishesResponse = {
	restaurant: SupabaseRestaurants;
	dish: SupabaseDishes;
	dish_media: SupabaseDishMedia;
	dish_reviews: SupabaseDishReviews[];
}[];
