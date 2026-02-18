import { IsString } from "class-validator";

/** DELETE /v1/users/me/blocked-dish-categories/:categoryId のパラメータ */
export class UnblockDishCategoryParamsDto {
	/** 料理カテゴリID (QID) */
	@IsString()
	categoryId!: string;
}
