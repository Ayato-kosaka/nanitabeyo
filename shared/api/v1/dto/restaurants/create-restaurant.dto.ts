import { IsString, Length } from "class-validator";

/** POST /v1/restaurants のボディ */
export class CreateRestaurantDto {
	/** Google Place ID */
	@IsString()
	googlePlaceId!: string;

	/** 言語コード (2〜5文字) */
	@IsString()
	@Length(2, 5)
	languageCode!: string;
}
