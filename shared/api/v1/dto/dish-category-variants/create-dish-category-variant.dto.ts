import { IsString } from "@nestjs/class-validator";

/** POST /v1/dish-category-variants のボディ */
export class CreateDishCategoryVariantDto {
        /** 名称 */
        @IsString()
        name!: string;
}
