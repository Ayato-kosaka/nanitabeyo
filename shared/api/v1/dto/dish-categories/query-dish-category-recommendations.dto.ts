import { IsOptional, IsString, Matches } from "class-validator";

/**
 * Query parameters for GET /v1/dish-categories/recommendations
 */
export class QueryDishCategoryRecommendationsDto {
	/**
	 * 住所トークン
	 * 例：
	 * - "country:JP, administrative_area_level_1:Kyoto, locality:Kyoto"
	 * - レガシー互換: "JP" （この場合 "country:JP" に変換）
	 */
	@IsString()
	address!: string;

	/** 利用時間帯 (timeSlot) 例: 'lunch', 'dinner', 'late_night' など */
	@IsOptional()
	@IsString()
	timeSlot?: string;

	/** シーン (scene) 例: 'date', 'family', 'solo' など */
	@IsOptional()
	@IsString()
	scene?: string;

	/** ユーザーのお腹の減り具合 (mood) 例: 'hearty', 'light' など */
	@IsOptional()
	@IsString()
	mood?: string;

	/** 食の制約 例: ['halal', 'vegan'] など */
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
	@IsString()
	@Matches(/^[a-z]{2,3}$/, {
		message: "localLanguageCode must be a 2-3 character language code (e.g., en, ja, ka)",
	})
	localLanguageCode!: string;
}
