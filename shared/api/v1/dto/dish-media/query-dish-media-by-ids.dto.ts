import { Transform } from "@nestjs/class-transformer";
import { ArrayNotEmpty, IsArray, IsUUID } from "@nestjs/class-validator";

/**
 * Query parameters accepted by **GET /v1/dish-media?ids=...**.
 * Accepts comma-separated or repeated `ids` parameters and preserves order.
 */
export class QueryDishMediaByIdsDto {
  @Transform(({ value }) => {
    if (Array.isArray(value)) {
      return value.flatMap((v) => v.split(","));
    }
    if (typeof value === "string") {
      return value.split(",");
    }
    return [];
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID(undefined, { each: true })
  readonly ids!: string[];
}
