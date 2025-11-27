import { IsArray, IsString, ArrayMinSize, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

/**
 * 個別の画像更新エントリー
 */
export class UpdateDishCategoryImageItem {
	/** 更新対象の dish_categories.id */
	@IsString()
	dishCategoryId!: string;

	/** 選択された dish_media.id */
	@IsString()
	dishMediaId!: string;
}

/**
 * POST /tools/dish-categories/update-images のリクエストボディ
 */
export class UpdateDishCategoryImagesDto {
	/** 更新対象のリスト */
	@IsArray()
	@ArrayMinSize(1)
	@ValidateNested({ each: true })
	@Type(() => UpdateDishCategoryImageItem)
	items!: UpdateDishCategoryImageItem[];
}
