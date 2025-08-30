import { IsUUID } from "class-validator";

/** POST /v1/dish-reviews/:id/likes/:userId のパスパラメータ */
export class LikeDishReviewParamsDto {
	/** dish_reviews.id */
	@IsUUID()
	id!: string;

	/** users.id */
	@IsUUID()
	userId!: string;
}
