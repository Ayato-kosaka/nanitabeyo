import { IsNumber } from "@nestjs/class-validator";
import { Type } from "@nestjs/class-transformer";

/** POST /v1/restaurants/:id/bids/intents のボディ */
export class CreateRestaurantBidIntentDto {
        @Type(() => Number)
        @IsNumber()
        amountCents!: number;
}
