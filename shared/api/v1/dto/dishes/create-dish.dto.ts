import { IsString, IsUUID } from "class-validator";

/** POST /v1/dishes のボディ */
export class CreateDishDto {
	/** restaurants.id */
	@IsUUID()
	restaurantId!: string;

	/** dish_categories.id */
	@IsString()
	dishCategoryId!: string;

	/** dishes.name */
	@IsString()
	dishName!: string;
}
