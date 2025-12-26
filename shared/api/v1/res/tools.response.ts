import { SupabaseDishCategories } from "../../../converters/convert_dish_categories";

/**
 * 候補メディア情報（メディアURL付き）
 */
export type CandidateDishMedia = {
	id: string;
	mediaSignedUrl: string;
};

/**
 * 人気カテゴリ + 候補メディア
 */
export type PopularDishCategoryWithMedia = {
	/** カテゴリ情報 */
	dishCategory: Pick<SupabaseDishCategories, "id" | "image_url"> & {
		name: string;
	};
	/** 紐づく dishes の件数 */
	dishCount: number;
	/** 候補となる dish_media 一覧（最大42件） */
	candidateMedia: CandidateDishMedia[];
};

/**
 * GET /tools/dish-categories/popular-with-media のレスポンス
 */
export type PopularDishCategoriesWithMediaResponse = PopularDishCategoryWithMedia[];
