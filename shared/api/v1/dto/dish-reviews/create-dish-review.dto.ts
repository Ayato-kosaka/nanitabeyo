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

	/** 言語コード */
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

	/** 作成された dish_media.id */
	@IsUUID()
	createdDishMediaId!: string;
}
