import { IsUUID } from "@nestjs/class-validator";

/** POST /v1/dishes のボディ */
export class CreateDishDto {
        /** restaurants.id */
        @IsUUID()
        restaurantId!: string;

        /** dish_categories.id */
        @IsUUID()
        dishCategory!: string;
}
