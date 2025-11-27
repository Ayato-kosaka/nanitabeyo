import { SupabaseDishCategories } from "../../../converters/convert_dish_categories";
import { SupabaseDishMedia } from "../../../converters/convert_dish_media";

/**
 * 候補メディア情報（サムネイルURL付き）
 */
export type CandidateDishMedia = SupabaseDishMedia & {
	/** CDN署名付きサムネイルURL */
	thumbnailUrl: string;
};

/**
 * 人気カテゴリ + 候補メディア
 */
export type PopularDishCategoryWithMedia = {
	/** カテゴリ情報 */
	dishCategory: SupabaseDishCategories;
	/** 紐づく dishes の件数 */
	dishCount: number;
	/** 候補となる dish_media 一覧（最大42件） */
	candidateMedia: CandidateDishMedia[];
};

/**
 * GET /tools/dish-categories/popular-with-media のレスポンス
 */
export type PopularDishCategoriesWithMediaResponse = PopularDishCategoryWithMedia[];

/**
 * POST /tools/dish-categories/update-images の成功レスポンス
 */
export type UpdateDishCategoryImagesResponse = {
	/** 成功フラグ */
	success: true;
	/** 更新されたカテゴリ数 */
	updatedCount: number;
};

/**
 * POST /tools/dish-categories/update-images の失敗レスポンス
 */
export type UpdateDishCategoryImagesErrorResponse = {
	/** 失敗フラグ */
	success: false;
	/** エラー情報 */
	error: {
		message: string;
		detail?: string[];
	};
};
