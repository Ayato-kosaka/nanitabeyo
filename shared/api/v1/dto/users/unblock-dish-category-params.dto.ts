import { IsUUID } from "class-validator";

/** DELETE /v1/users/me/blocked-dish-categories/:categoryId のパラメータ */
export class UnblockDishCategoryParamsDto {
	@IsUUID()
	categoryId!: string;
}
