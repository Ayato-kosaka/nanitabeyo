/**
 * #514 再 enqueue 結果のステータス
 * - enqueued: 指定サイズをすべて Cloud Tasks に投入した
 * - partially_enqueued: 一部のサイズだけ投入して途中で失敗した（`enqueuedSizes` が投入済み）
 * - skipped_record_not_found: レコードが存在しない
 * - skipped_original_path_empty: 原本パスが空（リサイズ対象なし）
 * - failed: 1 件も投入できずに失敗した
 *
 * `partially_enqueued` を `failed` と混ぜないこと。混ぜると運用者が「何も投入されていない」と
 * 誤解してそのまま再実行し、成功済みのサイズまで重複投入される。
 */
export type ReEnqueueResizeImageStatus =
	| "enqueued"
	| "partially_enqueued"
	| "skipped_record_not_found"
	| "skipped_original_path_empty"
	| "failed";

/** #514 再 enqueue 対象 1 件ごとの結果 */
export type ReEnqueueResizeImageResult = {
	table: string;
	column: string;
	recordId: string;
	status: ReEnqueueResizeImageStatus;
	/** 実際に投入したサイズ。`partially_enqueued` のときは投入済みの分だけが入る */
	enqueuedSizes: number[];
	/** skipped / failed / partially_enqueued の理由 */
	reason?: string;
};

/**
 * POST /ops/resize-image/re-enqueue のレスポンス
 */
export type ReEnqueueResizeImageResponse = {
	/** 受け付けた対象レコード数 */
	requestedTargets: number;
	/** 実際に投入した Cloud Tasks のタスク数 */
	enqueuedTasks: number;
	results: ReEnqueueResizeImageResult[];
};
