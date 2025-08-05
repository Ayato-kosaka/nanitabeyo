import { IsNumber, IsOptional, IsString, IsUUID } from "@nestjs/class-validator";
import { Type } from "@nestjs/class-transformer";

/** POST /v1/dish-reviews のボディ */
export class CreateDishReviewDto {
        /** dishes.id */
        @IsUUID()
        dishId!: string;

        /** コメント */
        @IsString()
        comment!: string;

        /** 価格 (セント) */
        @Type(() => Number)
        @IsNumber()
        priceCents!: number;

        /** 通貨コード */
        @IsString()
        currencyCode!: string;

        /** 評価 */
        @Type(() => Number)
        @IsNumber()
        rating!: number;

        /** 作成された dish_media.id */
        @IsOptional()
        @IsUUID()
        createdDishMediaId?: string;
}
