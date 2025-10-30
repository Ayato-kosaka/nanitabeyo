/**
 * POST /v1/device-tokens レスポンス
 */
export interface CreateDeviceTokenResponse {
	ok: true;
	token: string;
}
