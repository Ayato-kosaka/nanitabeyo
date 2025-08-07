import { IsOptional, IsString } from "@nestjs/class-validator";

/** GET /v1/restaurants/:id/restaurant-bids のクエリ */
export class QueryRestaurantBidsDto {
	@IsOptional()
	@IsString()
	cursor?: string;
}
