/**
 * API レスポンス共通型
 */
export interface BaseResponse<T> {
	/** レスポンスデータ本体 */
	data: T;
	/** API呼び出しの成否 */
	success: boolean;
	/** エラー時のコード */
	errorCode?: ErrorCode;
	/** エラー時のメッセージ */
	message?: string;
}

/**
 * API エラーコード定義
 */
export enum ErrorCode {
	/** 不明なエラー */
	INTERNAL_ERROR = "INTERNAL_ERROR",
	/** リクエストボディが不正 */
	INVALID_REQUEST_BODY = "INVALID_REQUEST_BODY",
	/** 認証エラー */
	UNAUTHORIZED = "UNAUTHORIZED",
	/** アクセス権限なし */
	FORBIDDEN = "FORBIDDEN",
	/** リソースが見つからない */
	NOT_FOUND = "NOT_FOUND",
	/** 重複エラー */
	CONFLICT = "CONFLICT",
	/** バリデーションエラー */
	VALIDATION_ERROR = "VALIDATION_ERROR",
	/** 外部サービスエラー */
	EXTERNAL_SERVICE_ERROR = "EXTERNAL_SERVICE_ERROR",
}
