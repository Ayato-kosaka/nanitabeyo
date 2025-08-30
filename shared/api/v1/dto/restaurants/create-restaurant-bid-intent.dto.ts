import { IsNumber } from "class-validator";
import { Type } from "class-transformer";

/** POST /v1/restaurants/:id/bids/intents のボディ */
export class CreateRestaurantBidIntentDto {
	@Type(() => Number)
	@IsNumber()
	amountCents!: number;
}
