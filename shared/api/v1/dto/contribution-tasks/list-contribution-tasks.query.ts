import { IsOptional, IsString, IsInt, Min, Max, IsISO8601 } from "class-validator";
import { IsParsableDateString } from "../is-parsable-date-string";
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
	@IsString()
	targetId?: string;

	/** 作成日時の開始（ISO8601形式、created_at >= from） */
	@IsOptional()
	// #1599 contribution-tasks.service.ts が new Date(query.from) して Prisma の
	// where へ載せるので、Invalid Date を通すと 500 になる。詳細は IsParsableDateString。
	@IsISO8601({ strict: true })
	@IsParsableDateString()
	from?: string;

	/** 作成日時の終了（ISO8601形式、created_at < to） */
	@IsOptional()
	@IsISO8601({ strict: true })
	@IsParsableDateString()
	to?: string;

	/** キーセットページングのカーソル（形式: {createdAt}|{id}） */
	@IsOptional()
	@IsString()
	cursor?: string;

	/** 取得件数（1–100、デフォルト20） */
	@IsOptional()
	@Transform(({ value }) => {
		if (value === undefined || value === null || value === "") {
			return 20;
		}
		return parseInt(value, 10);
	})
	@IsInt()
	@Min(1)
	@Max(100)
	limit?: number;

	/** payload/result を含めるかどうか（カンマ区切り：payload,result） */
	@IsOptional()
	@IsString()
	include?: string;
}
