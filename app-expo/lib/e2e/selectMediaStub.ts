import * as FileSystem from "expo-file-system";

import type { MediaData } from "../mediaSelection";

/**
 * 🎞 E2E(Detox) 専用: メディア選択を固定画像へ差し替えるフック（#1031 B6 の再開条件）。
 *
 * ## なぜ必要か
 * `ReviewForm` は画面に入った直後に `selectMedia()` を呼び、OS のフォトピッカーを開く。
 * フォトピッカーは **アプリ外プロセス**で動くため Detox からは一切操作できず、
 * レビュー投稿フローの自動化がそこで必ず止まる。
 * そこで E2E ビルドに限り「ピッカーを開かず、固定の画像を選んだことにする」経路を用意する。
 *
 * ## 本番混入ガード（#1030 と同じ二重構え）
 * 1. **主ガード**: metro.config.js の `resolveRequest` が、`EXPO_PUBLIC_E2E_MEDIA_HOOK !== "1"` の
 *    ビルドではこのファイルを `selectMediaStub.noop.ts` へ解決し直す。
 *    条件分岐 + minifier の DCE ではなく **モジュールグラフに入る時点で排除**する
 * 2. **CI ゲート**: `scripts/assert-no-e2e-hook.mjs` が本番相当バンドルに
 *    下の sentinel が含まれていないことを検査する（resolver 差し替えが壊れたら落ちる）
 *
 * ⚠️ selectMediaStub.noop.ts と公開シグネチャを必ず揃えること（差し替えは Metro の resolver 段で
 *    行われるため、型不一致は typecheck では検出できない）。
 */

/**
 * #1031 本ファイル（実装側）だけが持つ番号札。noop 側には置かない。
 * `scripts/assert-no-e2e-hook.mjs` はこの文字列の有無で本番バンドルへの混入を検知する。
 */
export const E2E_MEDIA_SELECTION_SENTINEL = "__E2E_MEDIA_SELECTION_HOOK__";

/**
 * 8x8 の単色 PNG（base64）。
 *
 * アセットとしてリポジトリへ画像を追加せずに済ませるため、バイト列を直接持つ。
 * `expo-asset` は app-expo の直接依存ではない（推移的依存にすぎない）ので使わない。
 */
const STUB_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAHElEQVQoz2P8//8/AzZgYmJiwCbBxMDAwEBIAgBjvwb/1Chz4gAAAABJRU5ErkJggg==";

/** 生成した固定画像の URI。同一プロセス内では 1 度だけ書き出せばよい */
let cachedUri: string | null = null;

/**
 * E2E ビルドで「メディアを選択した」ことにする固定画像を返す。
 *
 * @returns 差し替える MediaData。差し替えない場合は null（= 呼び出し側は通常のピッカーへ進む）
 */
export async function selectMediaForE2E(): Promise<MediaData | null> {
	void E2E_MEDIA_SELECTION_SENTINEL;

	// cacheDirectory はネイティブでのみ利用できる（web は E2E 対象外なので null なら差し替えない）
	if (!FileSystem.cacheDirectory) return null;

	if (!cachedUri) {
		const uri = `${FileSystem.cacheDirectory}e2e-review-media.png`;
		await FileSystem.writeAsStringAsync(uri, STUB_PNG_BASE64, {
			encoding: FileSystem.EncodingType.Base64,
		});
		cachedUri = uri;
	}

	return {
		type: "image",
		uri: cachedUri,
		width: 8,
		height: 8,
		mimeType: "image/png",
	};
}
