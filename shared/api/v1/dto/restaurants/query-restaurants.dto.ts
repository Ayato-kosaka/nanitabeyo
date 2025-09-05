import { IsNumber, IsOptional, IsString, Max, Min, IsPositive } from "class-validator";
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

	/**
	 * 返却件数（ページサイズ）
	 * min = 1 / max = 100
	 */
	@IsOptional()
	@Type(() => Number)
	@IsPositive()
	@Min(1)
	@Max(100)
	readonly limit?: number;

	@IsOptional()
	@IsString()
	cursor?: string;
}
