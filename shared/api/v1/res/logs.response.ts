/**
 * POST /v1/logs/frontend のレスポンス型
 * #489 【設計】フロントログ送信経路変更（Supabase → Backend API 経由）
 */
export interface CreateFrontendLogResponseDto {
	/** ログ送信成功フラグ（常に true を返す） */
	received: true;
}

/**
 * POST /v1/logs/frontend/batch のレスポンス型
 * #1079 要素単位の部分受理を行うため、受理／棄却件数を返す。
 *
 * 後方互換: `received: true` は不変で、フィールドの追加のみ（削除・改名・型変更なし）。
 * 単発エンドポイント POST /v1/logs/frontend のレスポンスは 1 バイトも変えないため、
 * 既存 interface へ optional 追加するのではなく extends で別型を足している。
 */
export interface CreateFrontendLogBatchResponseDto extends CreateFrontendLogResponseDto {
	/** Cloud Logging へ書き込みを試みた件数 */
	accepted: number;
	/** 検証に失敗して落とした件数（0 なら全件受理） */
	rejected: number;
}
