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

/**
 * #1629 直前の {@link enableAndroidSoftKeyboard} が何を見て何を選んだか。
 *
 * 失敗メッセージへ **実測値** を載せるために持つ。以前のメッセージは
 * 「エミュレータの IME が無効のままの可能性」と **推測**を書いており、
 * API 35 で落ちたときに次の一手を決められなかった。
 */
let lastEnableAttempt: { available: string[]; target: string | null; enabled: string[] } | null = null;

/** 現在の Detox デバイスに対して adb を実行する。失敗しても例外を投げない */
function adbQuiet(args: string[]): string {
	try {
		return execFileSync("adb", ["-s", device.id, ...args], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			/*
			#1629 ⚠️ **maxBuffer を既定（1 MB）のままにしないこと。**
			`dumpsys input_method` の全文は 1 MB を超えることがあり、超えると execFileSync が
			例外を投げる → ここで握り潰されて空文字が返る → «観測できなかった» が
			«キーボードが出ている» と区別できなくなる。実際に 1 度これで素通しした。
			端末側で grep して小さくするのが本筋だが、保険として広げておく。
			*/
			maxBuffer: 16 * 1024 * 1024,
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
	if (!target) {
		lastEnableAttempt = { available, target: null, enabled: [] };
		return;
	}

	adbQuiet(["shell", "ime", "enable", target]);
	adbQuiet(["shell", "ime", "set", target]);

	/*
	#1629 **何をしたのかを覚えておく。** 出なかったときの原因が «候補が 1 つも無い» のか
	«有効化はできたが出ない» のかで、次にやることが正反対になる。
	失敗してから adb を叩き直すことはできない（その頃には端末が落ちている）ので、
	ここで取った実測値を持ち回る。
	*/
	lastEnableAttempt = {
		available,
		target,
		enabled: adbQuiet(["shell", "ime", "list", "-s"]).split(/\s+/).filter(Boolean),
	};
}

/**
 * いまソフトウェアキーボードが表示されているかを読む（Android 専用）。
 *
 * `dumpsys input_method` の `mInputShown=true` が «IME のウィンドウが出ている» の唯一の観測点である。
 * iOS では読む手段が無いので `null` を返す（呼び出し側は判定をスキップする）。
 */
export function isAndroidSoftKeyboardShown(): boolean | null {
	if (device.getPlatform() !== "android") return null;
	/*
	#1629 **端末側で grep して 1 行だけ持ってくる。**
	`dumpsys input_method` の全文は大きく、ホスト側で受けると maxBuffer に当たって
	«観測できなかった» に化ける。欲しいのは `mInputShown=` の 1 行だけである。
	*/
	const line = adbQuiet(["shell", "dumpsys input_method | grep -m 1 mInputShown"]);
	if (!line) return null;
	return /mInputShown=true/.test(line);
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
	// iOS は観測手段が無いので素通しする（この関数を «iOS でも守っている» と読まないこと）
	if (device.getPlatform() !== "android") return;

	const shown = isAndroidSoftKeyboardShown();
	/*
	⚠️ #1629 **«読めなかった» を «出ている» 扱いにしないこと。**
	ここを `null` で素通しにしていたため、`dumpsys` の取得に失敗した回が
	そのまま緑になった。読めないなら «守れていない» のだから落とすのが正しい。
	*/
	if (shown === null) {
		throw new Error(
			"ソフトウェアキーボードの状態を読めなかった（adb / dumpsys input_method）。" +
				"出ているかどうか分からないまま «隠れていない» を確認しても意味が無いので落とす。",
		);
	}
	if (!shown) {
		/*
		#1629 **推測ではなく実測を載せる。** API 35 のイメージで «出なかった» とだけ言われても、
		候補が無いのか / 選べたのに出ないのかが分からず、次の一手を決められない。
		（実測: run 33348085300 / API 35 でここに到達した）
		*/
		const a = lastEnableAttempt;
		const detail = a
			? ` [IME: 選んだ=${a.target ?? "(候補なし)"} / 利用可能=${a.available.length}件${
					a.available.length ? `(${a.available.join(",")})` : ""
				} / 有効=${a.enabled.length}件${a.enabled.length ? `(${a.enabled.join(",")})` : ""}]`
			: " [IME: enableAndroidSoftKeyboard() が呼ばれていない]";
		throw new Error(onMissing() + detail);
	}
}
