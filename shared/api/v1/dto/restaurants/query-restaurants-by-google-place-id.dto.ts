import { IsString } from "class-validator";

/** GET /v1/restaurants/by-google-place-id のクエリ */
export class QueryRestaurantsByGooglePlaceIdDto {
	@IsString()
	googlePlaceId!: string;
}