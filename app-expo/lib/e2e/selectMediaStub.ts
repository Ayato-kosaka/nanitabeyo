import { Platform } from "react-native";
// #1156 Expo SDK 54 で expo-file-system は新 API が既定になった。
// 旧 API(cacheDirectory / EncodingType / FileSystemUploadType 等)は legacy サブパスへ移動している。
import * as FileSystem from "expo-file-system/legacy";

import { Env } from "@/constants/Env";

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
 * ## 本番混入ガード（#1030 / #1027 の兄弟フックと同形）
 * 1. **主ガード**: metro.config.js の `resolveRequest` が、`EXPO_PUBLIC_E2E_MEDIA_HOOK !== "1"` の
 *    ビルドと web バンドルではこのファイルを `selectMediaStub.noop.ts` へ解決し直す。
 *    条件分岐 + minifier の DCE ではなく **モジュールグラフに入る時点で排除**する
 * 2. **ランタイム二重ガード**: 本ファイル冒頭の早期 return（web 判定 /
 *    `process.env.EXPO_PUBLIC_E2E_MEDIA_HOOK !== "1"` / `Env.NODE_ENV === "production"`）。
 *    第 1 層を何らかの理由で通過しても、実ピッカーを開く通常経路へ倒す。
 *    ⚠️ `Env.NODE_ENV` は EXPO_PUBLIC_NODE_ENV 未設定だと undefined で素通りする（fail-open）ため、
 *    injectTestSession.ts と同じく **主ガードではない**（#1030 レビュー m-3）
 * 3. **CI ゲート**: `scripts/assert-no-e2e-hook.mjs` が本番相当バンドルに
 *    下の sentinel が含まれていないことを検査する（resolver 差し替えが壊れたら落ちる）
 *
 * #1127 【修正】以前このコメントは「#1030 と同じ二重構え」と書きながら、実装には
 * 1 と 3 しか無く **ランタイムガードだけが欠けていた**（兄弟フックとの fail-open 非対称）。
 * 記述と実装の食い違いを、実装側をそろえる形で解消している。
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
 * 8x8 の単色 PNG（base64）。8bit / colorType=2(truecolor) / 非インタレース。
 *
 * アセットとしてリポジトリへ画像を追加せずに済ませるため、バイト列を直接持つ。
 * `expo-asset` は app-expo の直接依存ではない（推移的依存にすぎない）ので使わない。
 *
 * #1127 【修正】旧データは **IDAT の CRC が不正**（stored=0xd42873e2 / actual=0x9868ebc6）で、
 * zlib 展開も adler32 チェックに失敗する（`incorrect data check`）壊れた PNG だった。
 * libspng/libpng は IHDR だけ読めるので寸法取得は通るが、実ピクセルのデコードで必ず落ちる。
 * つまり E2E でアップロードしても「有効な画像ではないファイル」が飛んでいた。
 * 現在の値は Node の zlib + CRC32 で生成し、pngjs(純 JS) と sharp(libvips) の
 * **2 つの別実装で 8x8 全ピクセルを復号できること**を検算済み。
 */
const STUB_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR42mP4EGqOFTEMLQkATTNfAeqEuWEAAAAASUVORK5CYII=";

/** 生成した固定画像の URI。同一プロセス内では 1 度だけ書き出せばよい */
let cachedUri: string | null = null;

/**
 * E2E ビルドで「メディアを選択した」ことにする固定画像を返す。
 *
 * @returns 差し替える MediaData。差し替えない場合は null（= 呼び出し側は通常のピッカーへ進む）
 */
export async function selectMediaForE2E(): Promise<MediaData | null> {
	void E2E_MEDIA_SELECTION_SENTINEL;

	// #1127 【セキュリティ】以下は兄弟フック（injectTestSession.ts / tutorialSeed.ts）と同形の
	// ランタイム二重ガード。metro resolver の差し替え（第 1 層）を何らかの理由で通過しても、
	// ここで必ず null（= 通常のフォトピッカーを開く）へ倒す。
	// web は Detox の対象外（metro.config.js も platform === "web" では noop へ差し替える）
	if (Platform.OS === "web") return null;
	// EXPO_PUBLIC_E2E_MEDIA_HOOK は Metro がビルド時にインライン化するため、未設定ビルドでは undefined に畳まれる
	if (process.env.EXPO_PUBLIC_E2E_MEDIA_HOOK !== "1") return null;
	// EAS production 環境でビルドされた成果物では絶対に動かさない
	// ⚠️ EXPO_PUBLIC_NODE_ENV が未設定だと undefined で素通りする（fail-open）ため、これは主ガードではない
	if (Env.NODE_ENV === "production") return null;

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
