import { IsOptional, IsString } from "class-validator";

/** GET /v1/users/me/content-reports のクエリ */
export class QueryMeContentReportsDto {
	/** 取得開始位置を示すカーソル（created_at の ISO 文字列） */
	@IsOptional()
	@IsString()
	cursor?: string;
}
