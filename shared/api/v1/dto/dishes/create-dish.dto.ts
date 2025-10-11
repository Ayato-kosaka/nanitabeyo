import { IsString, IsUUID, Length } from "class-validator";

/** POST /v1/dishes のボディ */
export class CreateDishDto {
	/** レストランID (UUID v4) */
	@IsUUID()
	restaurantId!: string;

	/** 料理カテゴリID (QID) */
	@IsString()
	dishCategoryId!: string;
}
