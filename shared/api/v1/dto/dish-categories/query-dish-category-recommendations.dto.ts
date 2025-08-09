import { IsNumber, IsOptional, IsString, Matches } from "@nestjs/class-validator";
import { Type } from "@nestjs/class-transformer";

/**
 * Query parameters for GET /v1/dish-categories/recommendations
 */
export class QueryDishCategoryRecommendationsDto {
	/** 位置情報 "lat,lng" */
	@Matches(/^-?\d{1,2}(?:\.\d+)?,-?\d{1,3}(?:\.\d+)?$/, { message: 'location must be "lat,lng" decimal format' })
	location!: string;

	/** 時間帯 */
	@IsOptional()
	@IsString()
	timeSlot?: string;

	/** シーン */
	@IsOptional()
	@IsString()
	scene?: string;

	/** 気分 */
	@IsOptional()
	@IsString()
	mood?: string;

	/** 制限 */
	@IsOptional()
	@IsString({ each: true })
	restrictions?: string[];

	/** 距離 (m) */
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	distance?: number;

	/** 最低予算 */
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	budgetMin?: number;

	/** 最高予算 */
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	budgetMax?: number;

	/** 言語タグ (IETF BCP 47準拠, 例: en-US, ja-JP, fr-CA) */
	@IsOptional()
	@IsString()
	@Matches(/^[a-z]{2,3}(-[A-Z]{2})?$/, {
		message: "languageTag must follow IETF BCP 47 format (e.g., en-US, ja-JP, fr-CA)",
	})
	languageTag?: string;
}
