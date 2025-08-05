import { IsNumber, IsOptional, IsString, Max, Min } from "@nestjs/class-validator";
import { Type } from "@nestjs/class-transformer";

/** GET /v1/restaurants のクエリ */
export class QueryRestaurantsDto {
        @Type(() => Number)
        @IsNumber()
        @Min(-90)
        @Max(90)
        lat!: number;

        @Type(() => Number)
        @IsNumber()
        @Min(-180)
        @Max(180)
        lng!: number;

        @Type(() => Number)
        @IsNumber()
        radius!: number;

        @IsOptional()
        @IsString()
        cursor?: string;
}
