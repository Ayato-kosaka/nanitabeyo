import { IsOptional, IsString } from "class-validator";

/** GET /v1/users/me/blocked-dish-categories のクエリ */
export class QueryMeBlockedDishCategoriesDto {
	@IsOptional()
	@IsString()
	cursor?: string;
}
