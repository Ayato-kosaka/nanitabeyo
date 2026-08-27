import { IsNumber, IsOptional, IsString, IsUUID, Matches, Max, Min } from "class-validator";
import { CURRENCY_CODE_PATTERN } from "../../currency-code";
import { Type } from "class-transformer";

/** POST /v1/dish-reviews のボディ */
export class CreateDishReviewDto {
	/** dishes.id */
	@IsUUID()
	dishId!: string;

	/** コメント */
	@IsString()
	comment!: string;

	/** 言語コード  (例: 'en', 'ja') */
	@IsString()
	languageCode!: string;

	/** 価格 (セント) */
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	priceCents?: number;

	/** 通貨コード */
	/**
	 * ISO-4217 の通貨コード（3 文字）。
	 *
	 * #1599 `@IsString()` だけだった。DB 側は `currency_code CHAR(3)` なので、
	 * 4 文字以上を送ると Postgres が `value too long for type character(3)` で落ち、
	 * **400 ではなく 500** になる。3 文字未満は空白で右詰めされて黙って保存される。
	 *
	 * ⚠️ `@IsISO4217CurrencyCode()` は使わない。class-validator が持つ ISO-4217 の
	 * 一覧が古く、**アプリ自身が送りうる `ZWG`（ジンバブエ・ゴールド、2024 年導入）を
	 * 弾いてしまう**（`COUNTRY_TO_CURRENCY_MAP` の 151 コードを実際に通して確認）。
	 * 通貨の一覧を 2 箇所で持つと必ずずれるので、ここでは **DB の制約と同じ «英字 3 文字»**
	 * だけを見る。どの通貨を扱うかは `googlePlaces.ts` の対応表が正本。
	 */
	@IsOptional()
	@IsString()
	@Matches(CURRENCY_CODE_PATTERN, {
		message: "currencyCode must be a 3-letter currency code (e.g. JPY, USD)",
	})
	currencyCode?: string;

	/** 評価 */
	@Type(() => Number)
	@IsNumber()
	@Min(1)
	@Max(5)
	rating!: number;

	/**
	 * 作成された dish_media.id
	 *
	 * #1395 写真なしで「食べた」を記録できるようにするため **任意**。
	 * 省略すると `dish_reviews.created_dish_media_id` は NULL になり、
	 * 一覧・Map・Calendar ではプレースホルダー表示になる。
	 *
	 * ⚠️ 省略を許す書き込みは、マイグレーション 20260819T0000
	 * （`created_dish_media_id` の DROP NOT NULL）**適用後**にのみ有効にすること。
	 * 先に出すと 500 になる。
	 */
	@IsOptional()
	@IsUUID()
	createdDishMediaId?: string;
}
