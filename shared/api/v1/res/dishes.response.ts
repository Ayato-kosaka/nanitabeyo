import { SupabaseRestaurants } from "../../../converters/convert_restaurants";
import { SupabaseDishes } from "../../../converters/convert_dishes";
import { SupabaseDishMedia } from "../../../converters/convert_dish_media";
import { SupabaseDishReviews } from "../../../converters/convert_dish_reviews";
import { DishMediaEntry } from "./dish-media.response";

/** POST /v1/dishes のレスポンス型 */
export type CreateDishResponse = SupabaseDishes;

/** 軽量プレビューエントリ型 */
export interface BulkImportPreviewEntry {
	placeId: string;
	restaurantName: string;
	photoUrl: string;
	categoryName: string;
	reviewCount: number;
}

/** POST /v1/dishes/bulk-import のレスポンス型（軽量プレビュー） */
export type BulkImportDishesResponse = BulkImportPreviewEntry[];
