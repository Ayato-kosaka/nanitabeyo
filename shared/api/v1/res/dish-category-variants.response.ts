import { PrismaDishCategories } from "../../../converters/convert_dish_categories";

/** GET /v1/dish-category-variants のレスポンス型 */
export type QueryDishCategoryVariantsResponse = {
        dishCategoryId: string;
        label: string;
}[];

/** POST /v1/dish-category-variants のレスポンス型 */
export type CreateDishCategoryVariantResponse = PrismaDishCategories[];
