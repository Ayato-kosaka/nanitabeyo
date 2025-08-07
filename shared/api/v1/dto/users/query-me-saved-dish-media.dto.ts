import { IsOptional, IsString } from "@nestjs/class-validator";

/** GET /v1/users/me/saved-dish-media のクエリ */
export class QueryMeSavedDishMediaDto {
	@IsOptional()
	@IsString()
	cursor?: string;
}
