import { IsUUID } from "class-validator";

/** POST /v1/dish-reviews/:id/likes のパスパラメータ */
export class LikeDishReviewParamsDto {
	/** dish_reviews.id */
	@IsUUID()
	id!: string;
}
