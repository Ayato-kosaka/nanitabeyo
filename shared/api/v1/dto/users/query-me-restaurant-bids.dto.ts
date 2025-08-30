import { IsOptional, IsString } from "class-validator";

/** GET /v1/users/me/restaurant-bids のクエリ */
export class QueryMeRestaurantBidsDto {
	@IsOptional()
	@IsString()
	cursor?: string;
}
