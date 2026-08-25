import { IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { Type } from "class-transformer";

/**
 * PATCH /v1/dish-reviews/:id のボディ (#1513)
 *
 * 【メディアは差し替えられない】
 * このボディには `createdDishMediaId` も `mediaPath` も **意図的に存在しない**。
 * 写真・動画の差し替えを許すと GCS の実体・変換パイプライン(media_processing_status)・
 * サムネイル・署名 URL の整合を全部扱うことになるため、オーナー確定仕様で対象外にしている。
 * ここに媒体系のフィールドを足さないこと。
 *
 * 【競合検知】
 * `lockNo` は必須。サーバは `WHERE id = ? AND lock_no = ?` で更新し、
 * 0 件なら 409 を返す。これが無いと同時編集が黙って後勝ちになる。
 */
export class UpdateDishReviewDto {
	/** 編集前に読んだ dish_reviews.lock_no。ズレていれば 409 Conflict */
	@Type(() => Number)
	@IsInt()
	@Min(0)
	lockNo!: number;

	/** コメント本文 */
	@IsOptional()
	@IsString()
	@MaxLength(2000)
	comment?: string;

	/**
	 * コメント本文の言語コード (例: 'en', 'ja')。
	 * 本文を書き換えると言語が変わりうるので、編集でも指定できるようにしている。
	 */
	@IsOptional()
	@IsString()
	@MaxLength(20)
	languageCode?: string;

	/** 評価 (1-5) */
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(1)
	@Max(5)
	rating?: number;

	/** 価格 (セント)。null で「価格を消す」を表現する */
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	priceCents?: number | null;

	/** 通貨コード。null で「価格を消す」を表現する */
	@IsOptional()
	@IsString()
	@MaxLength(3)
	currencyCode?: string | null;
}
