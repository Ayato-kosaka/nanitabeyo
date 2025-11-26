import { IsString, Length } from "class-validator";

/** POST /v1/restaurants のボディ */
export class CreateRestaurantDto {
	/** Google Place ID */
	@IsString()
	googlePlaceId!: string;
}
