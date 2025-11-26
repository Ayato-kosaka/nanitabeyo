import { IsIn, IsObject, IsOptional, IsString } from "class-validator";

/**
 * POST /v1/logs/frontend のボディ
 * #489 【設計】フロントログ送信経路変更（Supabase → Backend API 経由）
 */
export class CreateFrontendLogDto {
	/** イベント名称（例: "onCapture", "playAudio" など） */
	@IsString()
	event_name!: string;

	/** 現在のパス名 */
	@IsString()
	path_name!: string;

	/** 任意の付加情報（オブジェクト形式） */
	@IsObject()
	payload!: Record<string, any>;

	/** エラーレベル（"verbose", "debug", "log", "warn", "error" のいずれか） */
	@IsIn(["verbose", "debug", "log", "warn", "error"])
	error_level!: "verbose" | "debug" | "log" | "warn" | "error";

	/** ログ生成日時（ISO 8601形式） */
	@IsString()
	created_at!: string;

	/** アプリバージョン */
	@IsString()
	created_app_version!: string;

	/** コミットID */
	@IsString()
	created_commit_id!: string;
}
