import { IsNumber, IsUUID, Matches } from "@nestjs/class-validator";
import { Type } from "@nestjs/class-transformer";

/** POST /v1/dishes/bulk-import のボディ */
export class BulkImportDishesDto {
        /** location "lat,lng" */
        @Matches(/^-?\d{1,2}(?:\.\d+)?,-?\d{1,3}(?:\.\d+)?$/, { message: 'location must be "lat,lng" decimal format' })
        location!: string;

        /** 半径 (m) */
        @Type(() => Number)
        @IsNumber()
        radius!: number;

        /** dish_categories.id */
        @IsUUID()
        category!: string;
}
