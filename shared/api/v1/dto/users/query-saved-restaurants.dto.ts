import { IsNumber, IsOptional, IsPositive, Max, Min } from "class-validator";
import { Type } from "class-transformer";
import { MAX_SEARCH_RADIUS_M } from "../../../../utils/geo_search";

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

	/**
	 * 検索半径（m）。#1629 で 50km の頭打ちを外した（詳細は QueryRestaurantsDto.radius）。
	 * この経路の駆動表はそのユーザーが保存した店なので、半径を広げても行数は増えない。
	 */
	@Type(() => Number)
	@IsNumber()
	@IsPositive()
	@Max(MAX_SEARCH_RADIUS_M)
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
	@Min(0)
	readonly offset?: number;
}
