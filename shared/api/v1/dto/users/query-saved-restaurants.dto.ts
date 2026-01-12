import { IsNumber, IsOptional, IsPositive, Max, Min } from "class-validator";
import { Type } from "class-transformer";

/** GET /v1/users/me/saved-restaurants のクエリパラメータ */
export class QuerySavedRestaurantsDto {
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
	@IsPositive()
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

	/**
	 * オフセット（ページネーション用）
	 */
	@IsOptional()
	@Type(() => Number)
	@IsPositive()
	@Min(0)
	readonly offset?: number;
}
