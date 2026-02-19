import { IsOptional, IsString } from "class-validator";

/** GET /v1/users/me/blocked-dish-categories のクエリ */
export class QueryMeBlockedDishCategoriesDto {
	/** 取得開始位置を示すカーソル (created_atのISO文字列) */
	@IsOptional()
	@IsString()
	cursor?: string;
}
