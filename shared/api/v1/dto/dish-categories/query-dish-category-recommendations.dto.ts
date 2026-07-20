import { IsArray, IsOptional, IsString, Matches } from "class-validator";
import { Transform } from "class-transformer";

// Expo の locale は script subtag を含むことがある。検索開始前に正当な
// `zh-Hans` / `zh-Hant-TW` 等を ValidationError にしない範囲で受け入れる。
const BCP47_LANGUAGE_TAG_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z]{4})?(?:-(?:[A-Za-z]{2}|\d{3}))?$/;

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

// GET query の repeated / comma-separated の両形式を string[] に正規化する
const normalizeOptionalStringArray = () =>
	Transform(({ value }) => {
		if (value === undefined || value === null) return undefined;

		const values = Array.isArray(value) ? value : [value];
		const normalized = values
			.flatMap((v) => (typeof v === "string" ? v.split(",") : [v]))
			.filter((v): v is string => typeof v === "string")
			.map((v) => v.trim())
			.filter((v) => v !== "" && v.toLowerCase() !== "undefined" && v.toLowerCase() !== "null");

		return normalized.length > 0 ? normalized : undefined;
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
	/** @deprecated 検索画面からは送信しない。旧クライアント互換のため一時的に残す。 */
	@IsOptional()
	@normalizeOptionalString()
	@IsString()
	mood?: string;

	/**
	 * 味の好み (taste)
	 * #876 想定値: sweet, spicy, healthy, junk
	 */
	@IsOptional()
	@normalizeOptionalString()
	@IsString()
	taste?: string;

	/**
	 * 予算意図。
	 * フロントは店舗検索用 priceLevels を budget_intent の feature_key に変換して送る。
	 *
	 * #876 想定値: inexpensive, moderate, expensive, very_expensive
	 */
	@IsOptional()
	@normalizeOptionalStringArray()
	@IsArray()
	@IsString({ each: true })
	budgetIntent?: string[];

	/**
	 * 食事にかける時間 (dining_pace)
	 * #876 想定値: quick, leisurely
	 */
	@IsOptional()
	@normalizeOptionalString()
	@IsString()
	diningPace?: string;

	/**
	 * 中核食材・主食系 (core_ingredient)
	 * #876 想定値: meat, fish, rice, noodle
	 */
	@IsOptional()
	@normalizeOptionalString()
	@IsString()
	coreIngredient?: string;

	/** 言語タグ (IETF BCP 47準拠, 例: en-US, ja-JP, fr-CA) */
	/** TopicTitle や Reason の翻訳に使用される */
	@IsString()
	@Matches(BCP47_LANGUAGE_TAG_PATTERN, {
		message: "languageTag must follow IETF BCP 47 format (e.g., en-US, ja-JP, fr-CA)",
	})
	languageTag!: string;

	/** 現地言語タグ (例: ka, ja, zh-Hant) */
	/** res.category の現地言語名取得に利用し後続の Google Maps TextSearch に渡される */
	@IsString()
	@Matches(BCP47_LANGUAGE_TAG_PATTERN, {
		message: "localLanguageCode must follow IETF BCP 47 format (e.g., en, ja, zh-Hant)",
	})
	localLanguageCode!: string;
}
