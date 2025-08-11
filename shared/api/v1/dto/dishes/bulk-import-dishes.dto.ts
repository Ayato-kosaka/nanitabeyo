import { IsNumber, IsString, IsUUID, Matches, IsArray, Min, Max, Length, IsIn } from "@nestjs/class-validator";
import { Type } from "@nestjs/class-transformer";

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

	/** 言語コード (2〜5文字) */
	@IsString()
	@Length(2, 5)
	languageCode!: string;

	/** 価格レベル配列 (0: FREE, 1: INEXPENSIVE, 2: MODERATE, 3: EXPENSIVE, 4: VERY_EXPENSIVE) */
	@IsArray()
	@IsNumber({}, { each: true })
	@IsIn([0, 1, 2, 3, 4], { each: true })
	@Type(() => Number)
	priceLevels!: number[];
}
