import { IsOptional, IsString, IsUUID, IsInt, Min, Max, IsISO8601 } from "class-validator";
import { Transform } from "class-transformer";

/**
 * GET /v1/contribution-tasks クエリパラメータ
 *
 * 自分の協力タスク履歴を取得する際のフィルタリング条件
 */
export class ListContributionTasksQueryDto {
	/** タスクキーでフィルタ */
	@IsOptional()
	@IsString()
	taskKey?: string;

	/** タイプでフィルタ */
	@IsOptional()
	@IsString()
	type?: string;

	/** 対象タイプでフィルタ */
	@IsOptional()
	@IsString()
	targetType?: string;

	/** 対象IDでフィルタ */
	@IsOptional()
	@IsUUID()
	targetId?: string;

	/** 作成日時の開始（ISO8601形式、created_at >= from） */
	@IsOptional()
	@IsISO8601()
	from?: string;

	/** 作成日時の終了（ISO8601形式、created_at < to） */
	@IsOptional()
	@IsISO8601()
	to?: string;

	/** キーセットページングのカーソル（形式: {createdAt}|{id}） */
	@IsOptional()
	@IsString()
	cursor?: string;

	/** 取得件数（1–100、デフォルト20） */
	@IsOptional()
	@Transform(({ value }) => parseInt(value, 10))
	@IsInt()
	@Min(1)
	@Max(100)
	limit?: number = 20;

	/** payload/result を含めるかどうか（カンマ区切り：payload,result） */
	@IsOptional()
	@IsString()
	include?: string;
}
