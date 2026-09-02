import type { TrueSheet } from "@lodev09/react-native-true-sheet";
import type { RefObject } from "react";

/**
 * 🛟 TrueSheet の present / dismiss を «ネイティブ側が消えていても落ちない» 形で呼ぶ。
 *
 * ## なぜ要るのか（実機で踏んだ）
 * `@lodev09/react-native-true-sheet` はネイティブ側でシートを **tag** で管理しており、
 * 既に破棄された tag に対して present / dismiss を呼ぶと
 *
 *   Error: No sheet found with tag 9448
 *
 * を **reject** する。JS 側の `ref.current` は null になっていないことがあるため、
 * `ref.current?.present()` のオプショナルチェーンでは防げない。
 *
 * さらに呼び出し側が `void ref.current?.present()` のように Promise を捨てていると、
 * この reject が **unhandled promise rejection** になる。実機ログ:
 *
 *   ERROR [Error: Uncaught (in promise, id: 3) Error: No sheet found with tag 9448]
 *
 * ## いつ起きるか
 * **画面がまだ生きているうちに present を予約し、予約が消化される前に画面が外れる**とき。
 * ディープリンクでアプリを起動した直後がまさにそれで、
 * `search` タブがいったんマウント → チュートリアルシートが present を予約 →
 * すぐ投票画面へ遷移してシートのネイティブビューが破棄される、という順序になる。
 * LINE から共有リンクを開いてアプリが起動する経路で実際に発生した。
 *
 * ## 方針
 * 「シートがもう無い」は **異常ではなく想定内**なので、握りつぶして false を返す。
 * 呼び出し側は成否を見て再試行を止められる。
 * それ以外の例外は握りつぶさずに投げ直す（本当の不具合を隠さないため）。
 */

/** ネイティブ側にシートが存在しないことを示すメッセージか */
function isSheetGoneError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /No sheet found with tag/i.test(message);
}

/**
 * シートを開く。既にネイティブ側が破棄されていれば何もせず false を返す。
 *
 * @returns 実際に present を呼べたか
 */
export async function presentSheetSafely(ref: RefObject<TrueSheet | null>): Promise<boolean> {
	const sheet = ref.current;
	if (!sheet) return false;
	try {
		await sheet.present();
		return true;
	} catch (error) {
		if (isSheetGoneError(error)) return false;
		throw error;
	}
}

/**
 * シートを閉じる。既にネイティブ側が破棄されていれば何もせず false を返す。
 *
 * @returns 実際に dismiss を呼べたか
 */
export async function dismissSheetSafely(ref: RefObject<TrueSheet | null>): Promise<boolean> {
	const sheet = ref.current;
	if (!sheet) return false;
	try {
		await sheet.dismiss();
		return true;
	} catch (error) {
		if (isSheetGoneError(error)) return false;
		throw error;
	}
}
