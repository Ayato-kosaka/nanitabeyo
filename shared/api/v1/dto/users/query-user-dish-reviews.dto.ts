import { IsOptional, IsString } from "class-validator";

/** GET /v1/users/:id/dish-reviews のクエリ */
export class QueryUserDishReviewsDto {
	@IsOptional()
	@IsString()
	cursor?: string;
}
