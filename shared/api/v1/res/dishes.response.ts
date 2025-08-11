import { SupabaseDishes } from "../../../converters/convert_dishes";
import { DishMediaEntry } from "./dish-media.response";

/** POST /v1/dishes のレスポンス型 */
export type CreateDishResponse = SupabaseDishes;

/** POST /v1/dishes/bulk-import のレスポンス型 */
export type BulkImportDishesResponse = DishMediaEntry[];
