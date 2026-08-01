import { IsNumber, IsString, IsUUID, Matches, IsArray, Min, Max, IsIn, IsOptional } from "class-validator";
import { Type } from "class-transformer";
import { BCP47_LANGUAGE_TAG_PATTERN } from "../../../../utils/languageCode";

/** POST /v1/dishes/bulk-import のボディ */
export class BulkImportDishesDto {
	/** location "lat,lng" */
	@Matches(/^-?\d{1,2}(?:\.\d+)?,-?\d{1,3}(?:\.\d+)?$/, { message: 'location must be "lat,lng" decimal format' })
	location!: string;

	/** 半径 (m) */
	@Type(() => Number)
	@IsNumber()
	radius!: number;

	/** dish_categories.id */
	@IsString()
	categoryId!: string;

	/** dish_categories.name */
	@IsString()
	categoryName!: string;

	/** 最小評価 (0〜5, 0.5刻み) */
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	@Max(5)
	minRating!: number;

	/**
	 * レストランの所属する地域の言語コード（IETF BCP 47）
	 *
	 * #1052 【バグ】以前は `@Length(2, 5)` だったため、`zh-Hans`(7文字) や
	 * `zh-Hant`(7文字) で **bulk-import が丸ごと 400 になっていた**。
	 * app 側は `searchLocationLanguageCode` をそのまま送るので、
	 * `resolveLocalLanguageCode()` が中国語圏で返す値がそのまま弾かれる。
	 * 検証は他の DTO と同じ共有パターンへ揃える。
	 */
	@IsString()
	@Matches(BCP47_LANGUAGE_TAG_PATTERN, {
		message: "languageCode must follow IETF BCP 47 format (e.g., en, ja, zh-Hant)",
	})
	languageCode!: string;

	/** 価格レベル配列 */
	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	@IsIn(["PRICE_LEVEL_INEXPENSIVE", "PRICE_LEVEL_MODERATE", "PRICE_LEVEL_EXPENSIVE", "PRICE_LEVEL_VERY_EXPENSIVE"], {
		each: true,
	})
	priceLevels?: string[];
}
