import { SupabaseDishReviews } from "../../../converters/convert_dish_reviews";

/** POST /v1/dish-reviews のレスポンス型 */
export type CreateDishReviewResponse = SupabaseDishReviews;

/** POST /v1/dish-reviews/:id/likes/:userId のレスポンス型 */
export type LikeDishReviewResponse = void;

/** PATCH /v1/dish-reviews/:id のレスポンス型 (#1513) */
export type UpdateDishReviewResponse = SupabaseDishReviews;

/**
 * DELETE /v1/dish-reviews/:id のレスポンス型 (#1513)
 *
 * 論理削除なので行は残るが、返すのは「消えた」という事実だけにする。
 * 削除済みの本文をレスポンスへ載せると、クライアントのキャッシュに再表示される余地が残る。
 */
export type DeleteDishReviewResponse = {
	/** 論理削除した dish_reviews.id */
	id: string;
	/** 論理削除日時 (ISO8601) */
	deletedAt: string;
};
