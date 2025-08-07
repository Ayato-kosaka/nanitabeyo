import { IsOptional, IsString } from "@nestjs/class-validator";

/** GET /v1/users/me/liked-dish-media のクエリ */
export class QueryMeLikedDishMediaDto {
	@IsOptional()
	@IsString()
	cursor?: string;
}
