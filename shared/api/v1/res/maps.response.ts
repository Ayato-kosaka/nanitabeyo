/**
 * 🗺️ Maps Embed のレスポンス型（#843 / #1810）。
 */

/** `POST /v1/maps/embed-token` のレスポンス */
export type CreateMapsEmbedTokenResponse = {
	/** `GET /v1/maps/embed?token=<token>` にそのまま渡す短命トークン */
	token: string;
	/** トークンの有効期限（ISO 8601）。クライアントは表示しない（デバッグ用） */
	expiresAt: string;
};
