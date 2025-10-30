import { IsOptional, IsString, IsInt, Min, Max } from "class-validator";
import { Transform } from "class-transformer";

/**
 * GET /v1/notifications クエリパラメータ
 */
export class QueryNotificationsDto {
	/** キーセットページングのカーソル（形式: {createdAt}_{notificationId}） */
	@IsOptional()
	@IsString()
	cursor?: string;

	/** 取得件数（1–100、デフォルト30） */
	@IsOptional()
	@Transform(({ value }) => parseInt(value, 10))
	@IsInt()
	@Min(1)
	@Max(100)
	limit?: number = 30;
}
