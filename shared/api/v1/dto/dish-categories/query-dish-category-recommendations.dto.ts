import { IsOptional, IsString, Matches } from "@nestjs/class-validator";

/**
 * Query parameters for GET /v1/dish-categories/recommendations
 */
export class QueryDishCategoryRecommendationsDto {
	/** 住所 */
	@IsString()
	address!: string;

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

	/** 言語タグ (IETF BCP 47準拠, 例: en-US, ja-JP, fr-CA) */
	@IsString()
	@Matches(/^[a-z]{2,3}(-[A-Z]{2})?$/, {
		message: "languageTag must follow IETF BCP 47 format (e.g., en-US, ja-JP, fr-CA)",
	})
	languageTag!: string;

	/** 現地言語コード (例: ka, ja, en) */
	@IsOptional()
	@IsString()
	@Matches(/^[a-z]{2,3}$/, {
		message: "localLanguageCode must be a 2-3 character language code (e.g., en, ja, ka)",
	})
	localLanguageCode?: string;
}
