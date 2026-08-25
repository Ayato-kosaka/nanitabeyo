import { IsOptional, IsString } from "class-validator";

/** GET /v1/users/me/dish-category-group-votes のクエリ */
export class QueryMeDishCategoryGroupVotesDto {
	@IsOptional()
	@IsString()
	cursor?: string;
}
