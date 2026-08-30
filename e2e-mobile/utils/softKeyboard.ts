import { execFileSync } from "node:child_process";

import { device } from "detox";

/**
 * ⌨️ ソフトウェアキーボード（IME）を **本当に出すため**のヘルパ（Android 専用）
 *
 * ## なぜ要るのか — 前のテストは «絶対に落ちないテスト» だった
 *
 * `scripts/setup-android-locale.sh` は CI のエミュレータで **IME を全部 disable し、
 * `show_ime_with_hard_keyboard` を 0 にしている**（#1027。日本語 IME の初回セットアップ画面が
 * 画面下半分を覆い、その裏を Detox が可視判定できなかったため）。
 *
 * その状態では **タップしてもキーボードが 1 度も出ない**。
 * #1629 の「価格入力がキーボードに隠れる」を検証したつもりのテストは、
 * キーボードが出ない画面で「入力欄が見えている」を確認しており、**構造上、絶対に落ちなかった**。
 * 実際、テストは緑のままオーナーの実機では隠れ続けていた。
 *
 * ## このヘルパがやること
 *
 * 1. IME を有効化し、`show_ime_with_hard_keyboard` を 1 に戻す（キーボードが出る余地を作る）
 * 2. **本当に出たかを `dumpsys input_method` の `mInputShown` で確かめる**
 *
 * 2 が要点である。1 だけでは «出したつもり» にしかならず、同じ嘘を繰り返す。
 * 出せなかったときは呼び出し側が **テストを失敗させる**こと（黙って素通りさせない）。
 *
 * ## 日本語 IME を使わない
 *
 * #1027 が踏んだのは **日本語 IME のセットアップウィザード**である。ここで有効化するのは
 * ASCII の Latin IME だけで、文字入力は従来どおり `replaceText` を使う
 *（キーボードに «場所を占有させる» のが目的であって、打鍵させるためではない）。
 */

/** Latin IME（AOSP / Google 版のどちらか。イメージによって片方しか無い） */
const LATIN_IME_CANDIDATES = [
	"com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME",
	"com.android.inputmethod.latin/.LatinIME",
];

/** 現在の Detox デバイスに対して adb を実行する。失敗しても例外を投げない */
function adbQuiet(args: string[]): string {
	try {
		return execFileSync("adb", ["-s", device.id, ...args], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		return "";
	}
}

/**
 * ソフトウェアキーボードが出られる状態にする（Android 専用。iOS では何もしない）。
 *
 * `beforeAll` / `beforeEach` で 1 回呼べばよい。**この関数は «出せる状態にした» までしか保証しない。**
 * 実際に出たかは {@link expectSoftKeyboardShown} で確かめること。
 */
export function enableAndroidSoftKeyboard(): void {
	if (device.getPlatform() !== "android") return;

	// ハードウェアキーボード（エミュレータは既定で有効）が繋がっていても IME を出す
	adbQuiet(["shell", "settings", "put", "secure", "show_ime_with_hard_keyboard", "1"]);

	const available = adbQuiet(["shell", "ime", "list", "-a", "-s"]).split(/\s+/).filter(Boolean);
	const target = LATIN_IME_CANDIDATES.find((id) => available.includes(id)) ?? available[0];
	if (!target) return;

	adbQuiet(["shell", "ime", "enable", target]);
	adbQuiet(["shell", "ime", "set", target]);
}

/**
 * いまソフトウェアキーボードが表示されているかを読む（Android 専用）。
 *
 * `dumpsys input_method` の `mInputShown=true` が «IME のウィンドウが出ている» の唯一の観測点である。
 * iOS では読む手段が無いので `null` を返す（呼び出し側は判定をスキップする）。
 */
export function isAndroidSoftKeyboardShown(): boolean | null {
	if (device.getPlatform() !== "android") return null;
	const dump = adbQuiet(["shell", "dumpsys", "input_method"]);
	if (!dump) return null;
	return /mInputShown=true/.test(dump);
}

/**
 * ソフトウェアキーボードが **実際に出ていること** を要求する（Android 専用）。
 *
 * ⚠️ **キーボードが出ていないのに «隠れていない» を確認してはいけない。**
 * それはこのファイル冒頭に書いた «絶対に落ちないテスト» そのものである。
 *
 * @param onMissing 出ていなかったときに投げるエラーメッセージを組み立てる関数
 */
export function expectSoftKeyboardShown(onMissing: () => string): void {
	const shown = isAndroidSoftKeyboardShown();
	// iOS（null）は観測手段が無いので素通しする。Android で false のときだけ落とす
	if (shown === false) throw new Error(onMissing());
}
