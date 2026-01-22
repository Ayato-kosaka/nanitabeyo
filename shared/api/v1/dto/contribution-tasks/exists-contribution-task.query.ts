import { IsString, IsUUID, IsOptional, MinLength } from "class-validator";

/**
 * GET /v1/contribution-tasks/exists クエリパラメータ
 * 
 * 自分が既に特定のタスクを完了しているか確認する（二重防止）
 */
export class ExistsContributionTaskQueryDto {
	/** タスクキー（必須） */
	@IsString()
	@MinLength(1)
	taskKey!: string;

	/** 対象タイプ（必須） */
	@IsString()
	@MinLength(1)
	targetType!: string;

	/** 対象ID（必須） */
	@IsUUID()
	targetId!: string;

	/** タイプ（任意：type も一致する場合のみ true） */
	@IsOptional()
	@IsString()
	type?: string;
}
