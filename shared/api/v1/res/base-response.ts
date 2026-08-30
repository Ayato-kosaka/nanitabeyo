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
	/**
	 * 外部サービスの利用上限に達している（#1629）。
	 *
	 * Google Places の Text Search は **1 日あたりの上限**を持つ。使い切ると 429 を返し、
	 * それまで «その場で店を取り込む» ことに依存していた画面が黙って 0 件になる。
	 * `EXTERNAL_SERVICE_ERROR`（＝相手が壊れている）と混ぜると «時間を置けば直る» ことが
	 * クライアントから読めないので、コードを分けて «上限» だと言えるようにする。
	 */
	EXTERNAL_QUOTA_EXCEEDED = "EXTERNAL_QUOTA_EXCEEDED",
	/** 指定された場所はレストランや飲食店ではない */
	PLACE_NOT_FOOD_AND_DRINK = "PLACE_NOT_FOOD_AND_DRINK",
}
