import type { CreateFrontendLogDto } from "@shared/api/v1/dto";

/**
 * 📏 フロントログのバッチを «リクエストボディのバイト数» で分割する。
 *
 * ## なぜ件数だけでは足りないのか（実機で踏んだ）
 * 送信は 20 件 or 5 秒でまとめている（logQueue.ts）が、**1 件あたりのサイズには
 * 上限が無い**。`payload` が大きいログが混ざると、17 件でも body-parser の既定上限
 * 100 kB を超える。超えた場合サーバは Nest のルータへ到達する前に
 *
 *   PayloadTooLargeError: request entity too large
 *
 * を投げ、例外フィルタが «未処理例外» として **500** を返す。クライアントはこれを
 * `transient` と分類して **バッチごと捨てる**（再送しない設計）。
 * 実機のディープリンク起動直後に
 *
 *   ⚠️ frontend log batch dropped: kind=transient status=500 count=17
 *
 * が出ていたのがこれ。dev の Cloud Run ログで PayloadTooLargeError を実測して確定した。
 *
 * ## 方針
 * 送る前にバイト数で分割し、**そもそも上限を超えたリクエストを作らない**。
 * サーバ側の 413 マッピング（api/src/core/filters/api-exception.filter.ts）は
 * 「起きてしまったときに 500 に見えない」ための保険であって、こちらが本命。
 */

/**
 * サーバへ 1 リクエストで送ってよいボディの上限バイト数。
 *
 * ⚠️ **サーバ側（express body-parser の既定 100 kB）より小さくしておくこと。**
 * ここには `{"logs":[...]}` の封筒や、JSON エスケープでバイト数が増える分の
 * 余裕を持たせている。サーバの上限を変えたらこの値も見直すこと。
 */
export const MAX_BATCH_BYTES = 64 * 1024;

/**
 * 文字列の UTF-8 バイト長。
 *
 * ⚠️ `str.length` で代用しないこと。日本語のログ本文は 1 文字 3 バイトになるため、
 * 文字数で見積もると **実サイズを 1/3 に見誤る**（今回の症状そのもの）。
 * TextEncoder は React Native のランタイムで «あるとは限らない» ので自前で数える。
 */
export function utf8ByteLength(str: string): number {
	let bytes = 0;
	for (let i = 0; i < str.length; i++) {
		const code = str.charCodeAt(i);
		if (code < 0x80) bytes += 1;
		else if (code < 0x800) bytes += 2;
		else if (code >= 0xd800 && code <= 0xdbff) {
			// サロゲートペア（絵文字など）は 2 コードユニットで 4 バイト
			bytes += 4;
			i++;
		} else bytes += 3;
	}
	return bytes;
}

/** バイト数で分割した結果 */
export type SplitLogBatchesResult = {
	/** それぞれ maxBytes 以内に収まるバッチ。空配列になることもある */
	batches: CreateFrontendLogDto[][];
	/** 1 件だけで maxBytes を超えており、送っても必ず失敗するので捨てたログ */
	oversized: CreateFrontendLogDto[];
};

/**
 * ログの配列を、各バッチの合計が `maxBytes` を超えないように分割する。
 *
 * 1 件だけで上限を超えるログは `oversized` へ回して **送らない**。
 * 送れば必ず 413 になり、しかも同じ内容で毎回失敗するため、
 * 分割し続けても永久に通らない（呼び出し側で捨てて数えるのが正解）。
 *
 * ⚠️ 並び順は保つこと。ログは時系列に意味がある。
 */
export function splitLogBatchesByByteSize(
	logs: CreateFrontendLogDto[],
	maxBytes: number = MAX_BATCH_BYTES,
): SplitLogBatchesResult {
	const batches: CreateFrontendLogDto[][] = [];
	const oversized: CreateFrontendLogDto[] = [];

	let current: CreateFrontendLogDto[] = [];
	let currentBytes = 0;

	for (const log of logs) {
		// 要素間の "," も 1 バイト消費するので足しておく（見積もりは «多め» に倒す）
		const size = utf8ByteLength(JSON.stringify(log)) + 1;

		if (size > maxBytes) {
			oversized.push(log);
			continue;
		}

		if (current.length > 0 && currentBytes + size > maxBytes) {
			batches.push(current);
			current = [];
			currentBytes = 0;
		}

		current.push(log);
		currentBytes += size;
	}

	if (current.length > 0) batches.push(current);

	return { batches, oversized };
}
