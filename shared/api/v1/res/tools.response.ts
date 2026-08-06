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

/**
 * #514 再 enqueue 結果のステータス
 * - enqueued: Cloud Tasks に投入した
 * - skipped_record_not_found: レコードが存在しない
 * - skipped_original_path_empty: 原本パスが空（リサイズ対象なし）
 * - failed: enqueue 自体に失敗した
 */
export type ReEnqueueResizeImageStatus =
	| "enqueued"
	| "skipped_record_not_found"
	| "skipped_original_path_empty"
	| "failed";

/** #514 再 enqueue 対象 1 件ごとの結果 */
export type ReEnqueueResizeImageResult = {
	table: string;
	column: string;
	recordId: string;
	status: ReEnqueueResizeImageStatus;
	/** 実際に投入したサイズ */
	enqueuedSizes: number[];
	/** skipped / failed の理由 */
	reason?: string;
};

/**
 * POST /tools/resize-image/re-enqueue のレスポンス
 */
export type ReEnqueueResizeImageResponse = {
	/** 受け付けた対象レコード数 */
	requestedTargets: number;
	/** 実際に投入した Cloud Tasks のタスク数 */
	enqueuedTasks: number;
	results: ReEnqueueResizeImageResult[];
};
