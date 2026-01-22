import { IsString, IsInt, IsOptional, Min, Max, MinLength } from "class-validator";
import { Transform } from "class-transformer";

/**
 * GET /v1/contribution-tasks/completed-target-ids クエリパラメータ
 *
 * 誰かが完了済みのtargetIdの集計情報を取得（個人特定情報は含まない）
 */
export class CompletedTargetIdsQueryDto {
	/** タスクキー（必須） */
	@IsString()
	@MinLength(1)
	taskKey!: string;

	/** 対象タイプ（必須） */
	@IsString()
	@MinLength(1)
	targetType!: string;

	/** タイプ（任意フィルタ） */
	@IsOptional()
	@IsString()
	type?: string;

	/** 最小完了回数（デフォルト1） */
	@IsOptional()
	@Transform(({ value }) => parseInt(value, 10))
	@IsInt()
	@Min(1)
	minCount?: number = 1;

	/** 取得件数（1–1000、デフォルト200） */
	@IsOptional()
	@Transform(({ value }) => parseInt(value, 10))
	@IsInt()
	@Min(1)
	@Max(1000)
	limit?: number = 200;

	/** キーセットページングのカーソル（形式: {lastCompletedAt}_{targetId}） */
	@IsOptional()
	@IsString()
	cursor?: string;
}
