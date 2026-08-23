import { IsNumber, IsOptional, IsString, IsUUID, Max, Min } from "class-validator";
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
	@IsOptional()
	@IsString()
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
