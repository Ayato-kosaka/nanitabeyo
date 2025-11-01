/**
 * POST /v1/notifications/mark-all-read レスポンス
 */
export interface MarkAllReadResponse {
	lastReadAt: string; // ISO8601
}
