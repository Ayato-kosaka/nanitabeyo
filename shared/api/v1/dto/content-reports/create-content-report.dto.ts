import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";
import {
	CONTENT_REPORT_REASON_CODES,
	CONTENT_REPORT_REASON_TEXT_MAX_LENGTH,
	CONTENT_REPORT_TARGET_TYPES,
	type ContentReportReasonCode,
	type ContentReportTargetType,
} from "../../constants/contentReports";

/**
 * 🚩 `POST /v1/content-reports` のリクエスト（#1514 / SAF-01）。
 *
 * ## 通報者を body で受け取らない理由
 * 通報者は JWT（`@CurrentUser`）から取る。body に載せると、他人になりすました通報を
 * 作れてしまう。`content_reports.reporter_user_id` はサーバー側でしか埋めない。
 *
 * ## 通報の「対象」を polymorphic にしてある理由
 * `target_type` を持たない形にすると対象を増やすときにテーブルごと作り直しになる。
 * 対象は `CONTENT_REPORT_TARGET_TYPES`（投稿 `dish_media` とレビュー `dish_reviews`）で、
 * それ以外の値は 400 になる。ユーザー・店舗は対象外（オーナー確定仕様）。
 */
export class CreateContentReportDto {
	/** 通報対象の種別。`dish_media`（投稿）または `dish_reviews`（レビュー） */
	@IsIn(CONTENT_REPORT_TARGET_TYPES)
	targetType!: ContentReportTargetType;

	/**
	 * 通報対象の ID。`targetType` が示すテーブルの主キー。
	 *
	 * ⚠️ **バージョンを固定しないこと（`@IsUUID("4")` にしない）。**
	 * `dish_media.id` には v5 の ID が混ざっており（`ShareTargetDishMediaParamsDto` に
	 * 実測の記録がある）、v4 に固定すると実在する投稿の通報が必ず 400 になる。
	 */
	@IsUUID()
	targetId!: string;

	/** 通報理由（選択式）。集計できるようにコードで受ける */
	@IsIn(CONTENT_REPORT_REASON_CODES)
	reasonCode!: ContentReportReasonCode;

	/**
	 * 任意の自由記述。
	 *
	 * ⚠️ ここには第三者の個人情報が書かれうる。**外部（GitHub Issue 等）へ転記しないこと。**
	 * 既存の `POST /v1/feedback/issue` は public リポジトリの Issue へ本文をそのまま
	 * 埋めているので、あれと同じ扱いをしてはいけない。
	 */
	@IsOptional()
	@IsString()
	@MaxLength(CONTENT_REPORT_REASON_TEXT_MAX_LENGTH)
	reasonText?: string;
}
