import { IsOptional, IsString, Matches } from "class-validator";
import { Transform } from "class-transformer";

// 共通の正規化: undefined / null / 空文字 / "undefined" / "null" を undefined にする
const normalizeOptionalString = () =>
	Transform(({ value }) => {
		if (value === undefined || value === null) return undefined;
		if (typeof value !== "string") return value; // 念のため

		const v = value.trim();
		if (v === "" || v.toLowerCase() === "undefined" || v.toLowerCase() === "null") {
			return undefined;
		}
		return v;
	});

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
	@normalizeOptionalString()
	@IsString()
	timeSlot?: string;

	/** シーン (scene) 例: 'date', 'family', 'solo' など */
	@IsOptional()
	@normalizeOptionalString()
	@IsString()
	scene?: string;

	/** ユーザーのお腹の減り具合 (mood) 例: 'heavy', 'light' など */
	@IsOptional()
	@normalizeOptionalString()
	@IsString()
	mood?: string;

	/** 味の好み (taste) 例: 'spicy', 'savory', 'sweet' など */
	@IsOptional()
	@normalizeOptionalString()
	@IsString()
	taste?: string;

	/** 言語タグ (IETF BCP 47準拠, 例: en-US, ja-JP, fr-CA) */
	/** TopicTitle や Reason の翻訳に使用される */
	@IsString()
	@Matches(/^[a-z]{2,3}(-[A-Z]{2})?$/, {
		message: "languageTag must follow IETF BCP 47 format (e.g., en-US, ja-JP, fr-CA)",
	})
	languageTag!: string;

	/** 現地言語コード (例: ka, ja, en) */
	/** res.category の現地言語名取得に利用し後続の Google Maps TextSearch に渡される */
	@IsString()
	@Matches(/^[a-z]{2,3}$/, {
		message: "localLanguageCode must be a 2-3 character language code (e.g., en, ja, ka)",
	})
	localLanguageCode!: string;
}
