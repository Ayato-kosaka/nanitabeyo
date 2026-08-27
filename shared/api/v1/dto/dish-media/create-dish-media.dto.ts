import { IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, Min, ValidateIf, ValidateNested } from "class-validator";
import { CURRENCY_CODE_PATTERN } from "../../currency-code";
import { Type } from "class-transformer";

/**
 * #1560 投稿と一緒に作るレビュー。
 *
 * `dishId` を持たないのは、**メディアと同じ dish に決まっている**から。
 * `createdDishMediaId` を持たないのは、**いま作るメディアの id が入る**から。
 * どちらもクライアントに決めさせると、取り違えたときに «別の料理へレビューが付く» を
 * サーバー側で検出できなくなる。
 */
export class CreateDishMediaReviewDto {
	/** コメント */
	@IsString()
	comment!: string;

	/** 言語コード (例: 'en', 'ja') */
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
}

export class CreateDishMediaDto {
	/** 紐付ける料理 (dishes.id) */
	@IsUUID()
	dishId!: string;

	/** オブジェクトストレージのキー（例: gs://bucket/path.jpg） */
	@IsString()
	mediaPath!: string;

	/** メディア種別 */
	@IsIn(["image", "video"])
	mediaType!: "image" | "video";

	/** サムネイルパス（必須。IMAGE の場合は mediaPath と同じ値を渡す） */
	@IsString()
	thumbnailPath!: string;

	/** 動画の長さ（ミリ秒単位）。mediaType が video の場合に必須 */
	@ValidateIf((o) => o.mediaType === "video")
	@IsInt()
	@Min(0)
	videoDurationMs?: number;

	/**
	 * #1560 【設計】投稿と同時に作るレビュー。**同じトランザクションで書かれる。**
	 *
	 * ## なぜ足したか
	 *
	 * 投稿フローは `POST /v1/dish-media` → `POST /v1/dish-reviews` の 2 本に分かれており、
	 * 1 本目が成功して 2 本目が落ちると **dish_media だけが残る**。
	 * `GET /v1/users/me/dishes` の候補集合は want（reactions）と eaten（dish_reviews）の
	 * 2 系統しか無く、**dish_media を起点にした系統が無い**ため、その行は
	 * 一覧にもピンにも出ず、本人が到達する導線が消える。#1513 の「投稿を削除」でも消せない。
	 * ストレージに写真が残り続けるのに本人は見ることも消すこともできない状態になる（#1560）。
	 *
	 * ## 省略したときの意味
	 *
	 * 省略は「レビューを伴わない投稿を作る」ではなく、**従来どおりの 2 本立て**を指す。
	 * 既存の呼び出し側（他人のメディアへレビューを足す `review-from-media`、
	 * 写真なしの記録）は `POST /v1/dish-reviews` 単独のままで、この項目とは無関係。
	 */
	@IsOptional()
	@ValidateNested()
	@Type(() => CreateDishMediaReviewDto)
	review?: CreateDishMediaReviewDto;
}
