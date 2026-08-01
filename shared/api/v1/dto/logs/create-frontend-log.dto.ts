import { IsIn, IsObject, IsOptional, IsString } from "class-validator";
export { UNKNOWN_BUILD_META_CLIENT, UNKNOWN_BUILD_META_SERVER } from "../../constants/build-meta";

// ビルド時メタ情報（created_app_version / created_commit_id）を取得できなかったときの既定値。
// #1078 git SHA は [0-9a-f] のみで構成されるため、'u'/'n'/'k'/'w' を含むこれらの値が
// 実 SHA と衝突することは原理的にありえない。BigQuery 側は
// `STARTS_WITH(created_commit_id, 'unknown-')` で欠落由来の行を判別できる。
// （逆に「'unknown-' で始まらない ＝ 実 SHA」までは保証しない。'test-commit' 等の
//   非 SHA 文字列を送るクライアント／テストが存在しうるため）

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

	/**
	 * アプリバージョン
	 * #1078 メタ情報 1 個の欠落でログ本体を捨てない。欠落時は LogsService が
	 * UNKNOWN_BUILD_META_SERVER で補完する。@IsString() は残すので
	 * 「送ってきたが文字列でない」は従来どおり 400。緩めるのは「送ってこない」だけ。
	 */
	@IsOptional()
	@IsString()
	created_app_version?: string;

	/**
	 * コミットID
	 * #1078 同上（欠落を許容し、サーバ側で UNKNOWN_BUILD_META_SERVER を補完する）
	 */
	@IsOptional()
	@IsString()
	created_commit_id?: string;
}
