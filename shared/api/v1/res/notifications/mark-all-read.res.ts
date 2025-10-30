/**
 * POST /v1/notifications/mark-all-read レスポンス
 */
export interface MarkAllReadResponse {
	ok: true;
	lastReadAt: string; // ISO8601
}
