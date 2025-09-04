import { IsNumber, IsOptional, IsString, Max, Min } from "class-validator";
import { Type } from "class-transformer";

/** GET /v1/restaurants/search のクエリ */
export class QueryRestaurantsDto {
	@Type(() => Number)
	@IsNumber()
	@Min(-90)
	@Max(90)
	lat!: number;

	@Type(() => Number)
	@IsNumber()
	@Min(-180)
	@Max(180)
	lng!: number;

	@Type(() => Number)
	@IsNumber()
	radius!: number;

	@IsOptional()
	@IsString()
	cursor?: string;
}
