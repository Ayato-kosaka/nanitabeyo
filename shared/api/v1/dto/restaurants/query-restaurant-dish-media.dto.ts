import { Type } from "class-transformer";
import { IsOptional, IsPositive, IsString, Max, Min } from "class-validator";

/** GET /v1/restaurants/:id/dish-media のクエリ */
export class QueryRestaurantDishMediaDto {
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

	/**
	 * 前ページから渡されるカーソル
	 */
	@IsOptional()
	@IsString()
	readonly cursor?: string;
}
