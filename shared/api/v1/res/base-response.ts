/** API すべてが従う共通レスポンスラッパ */
export interface BaseResponse<T> {
	data: T | null;
	success: boolean;
	errorCode: ErrorCode | null;
}

export enum ErrorCode {
	NOT_FOUND = "NOT_FOUND",
	VALIDATION_ERROR = "VALIDATION_ERROR",
	AUTH_REQUIRED = "AUTH_REQUIRED",
	INTERNAL_ERROR = "INTERNAL_ERROR",
	// …
}
