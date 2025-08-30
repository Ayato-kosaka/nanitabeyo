import { IsOptional, IsString } from "class-validator";

/** GET /v1/users/me/saved-dish-media のクエリ */
export class QueryMeSavedDishMediaDto {
	@IsOptional()
	@IsString()
	cursor?: string;
}
