import { SupabaseDishReviews } from "../../../converters/convert_dish_reviews";

/** POST /v1/dish-reviews のレスポンス型 */
export type CreateDishReviewResponse = SupabaseDishReviews & {
	username: string;
	isLiked: boolean;
	likeCount: number;
};

/** POST /v1/dish-reviews/:id/likes/:userId のレスポンス型 */
export type LikeDishReviewResponse = void;
