/**
 * POST /v1/logs/frontend のレスポンス型
 * #489 【設計】フロントログ送信経路変更（Supabase → Backend API 経由）
 */
export interface CreateFrontendLogResponseDto {
	/** ログ送信成功フラグ（常に true を返す） */
	received: true;
}
