import { IsOptional, IsString } from "class-validator";

/** GET /v1/dish-category-variants のクエリ */
export class QueryDishCategoryVariantsDto {
	/** 検索語 */
	@IsString()
	q!: string;

	/** 言語コード（例: "ja", "en"） */
	@IsString()
	lang!: string;
}
