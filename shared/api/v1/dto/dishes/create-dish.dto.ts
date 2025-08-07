import { IsString, IsUUID } from "@nestjs/class-validator";
import { SupabaseDishCategories } from "shared/converters/convert_dish_categories";

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
