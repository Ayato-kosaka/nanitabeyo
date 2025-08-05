import { IsOptional, IsString } from "@nestjs/class-validator";

/** GET /v1/users/me/saved-dish-categories のクエリ */
export class QueryMeSavedDishCategoriesDto {
        @IsOptional()
        @IsString()
        cursor?: string;
}
