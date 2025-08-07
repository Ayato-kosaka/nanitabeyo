import { IsOptional, IsString } from "@nestjs/class-validator";

/** GET /v1/restaurants/:id/dish-media のクエリ */
export class QueryRestaurantDishMediaDto {
	@IsOptional()
	@IsString()
	cursor?: string;
}
