import { adbSync, isAndroidDevice } from "./adb";

/**
 * 🌏 デバイスロケール固定ヘルパ
 *
 * ## なぜ必要か（#1031 確定 B4）
 * `app-expo/app/index.tsx` は `expo-localization.getLocales()[0].languageTag` から locale を解決して
 * `/{locale}/...` へリダイレクトする。さらに検索チュートリアルは `isJapanese` ゲートで表示が分岐する。
 * つまり **デバイスのロケールが ja-JP でないとテストが再現しない**（「たまたま通る」状態になる）。
 * e2e-web は Playwright の `locale: "ja-JP"` 一発で固定できたが、Detox には同等の横断機能が無い。
 *
 * ## プラットフォーム別の担保方法（#1031 確定 B4 / #1028 R3）
 * | プラットフォーム | 方法 |
 * | --- | --- |
 * | iOS | `device.launchApp({ languageAndLocale })`（Detox 公式 API。**iOS 専用**） |
 * | Android | **AVD / エミュレータのシステムロケール**を ja-JP にする（CI は emulator 起動後に adb で設定する前提） |
 *
 * このモジュールは「iOS 用の launchApp 引数」と「Android 用の adb 操作 / 検証」をヘルパ化し、
 * fixtures/e2e.ts の起動ヘルパから透過的に使えるようにする。
 */

/** テストが前提とするロケール（BCP 47）。app-expo の `locales/ja-JP.json` に対応する */
export const E2E_LOCALE = "ja-JP";

/** テストが前提とする言語コード */
export const E2E_LANGUAGE = "ja";

/** app.config.ts の `scheme`。ディープリンクの組み立てに使う */
export const APP_SCHEME = "nanitabeyo";

/**
 * iOS の `device.launchApp()` へ渡すロケール指定を返す。
 *
 * #1028 【設計】Android では Detox が `languageAndLocale` を解釈しないため、
 * 呼び出し側は必ず `device.getPlatform() === "ios"` のときだけ展開すること
 * （このヘルパ自体はプラットフォーム判定を行わない純関数にしてある）。
 */
export function iosLanguageAndLocale(): Detox.LanguageAndLocale {
	return { language: E2E_LANGUAGE, locale: E2E_LOCALE };
}

/**
 * ロケールセグメント付きのディープリンク URL を組み立てる。
 *
 * #1031 【設計】expo-router は `/[locale]/...` 構成なので、ロケール依存の遷移は
 * 「システムロケールに任せる」より「locale セグメントを直接指定して開く」方が決定論的になる。
 *
 * @param pathname 例: "search", "search/dish-categories"（先頭のスラッシュは省略可）
 * @returns 例: "nanitabeyo:///ja-JP/search"
 */
export function localeDeepLink(pathname = ""): string {
	const normalized = pathname.replace(/^\/+/, "");
	return `${APP_SCHEME}:///${E2E_LOCALE}${normalized ? `/${normalized}` : ""}`;
}

/**
 * `am get-config` の出力から «アプリが実際に使うロケール» を取り出す。
 *
 * 例: `config: mcc310-mnc260-ja-rJP-ldltr-sw320dp-w320dp-h616dp-normal-...` → `"ja-JP"`
 *
 * 純粋関数にしてあるのは、adb 無しで両方向を確かめられるようにするため。
 */
export function parseLocaleFromAmGetConfig(output: string | null): string | null {
	if (!output) return null;
	const matched = /-([a-z]{2})-r([A-Z]{2})(?=-|$)/.exec(output);
	return matched ? `${matched[1]}-${matched[2]}` : null;
}

/** 実行時ロケールの観測を何回試すか（1 回目で取れなければ adbd の再接続を待って試し直す） */
const LOCALE_OBSERVE_ATTEMPTS = 3;

/** 観測の再試行の間隔（ms） */
const LOCALE_OBSERVE_RETRY_MS = 1_000;

/**
 * 再試行の前に端末の再接続を待つ上限（ms）。
 *
 * ⚠️ `adb wait-for-device` は **端末が現れるまで無限に待つ**。上限を外すと
 * «観測» が «無限の待機» に化ける（#1579 の真因そのもの）。
 */
const LOCALE_WAIT_FOR_DEVICE_MS = 5_000;

/**
 * Android の **実行時ロケール**（LocaleList = アプリが実際に使う値）を観測する。
 *
 * @returns 例: `"ja-JP"`。**観測できなかった場合は null**（«違うロケールだった» ではない）
 *
 * ## #1579 【バグ】観測の失敗を «違うロケールだった» と読み替えてはいけない
 *
 * 2026-09-28 / 09-29 の夜間 Android は、セットアップが
 *
 *     ▶ 実行時 configuration: config: mcc310-mnc260-ja-rJP-...   ← 端末は ja-JP
 *     ✅ システムロケールを ja-JP に固定しました
 *
 * を出しているのに、その 10〜50 分後のテスト実行中に
 *
 *     ⚠️ Android デバイスのロケールが ja-JP ではありません（現在: 取得不可）。
 *     ⚠️ Android ロケールが ja-JP ではない（現在: en-US）ため、ja-JP 前提の spec を skip します。
 *
 * を出した（[run 36641494595](https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/36641494595) /
 * [run 36498858912](https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/36498858912)。
 * 前夜 [36273907923](https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/36273907923) は
 * 同じセットアップ出力で 0 件なので **間欠**である）。
 *
 * «取得不可» が先に出ていることが答えで、**この `en-US` は端末から読んだ値ではなく、
 * 観測に失敗したあとフォールバックが作り出した値**だった。旧実装は 3 段だった:
 *
 * 1. `am get-config`（実行時ロケール。**唯一の正**）
 * 2. `getprop persist.sys.locale` … `-no-snapshot-save` の CI では実行中に空へ戻ることがある
 * 3. `getprop ro.product.locale` … **AVD の作りつけの値。このイメージでは常に `en-US`**
 *
 * 1 が一瞬失敗すると（アプリ再起動中・adbd の再接続中などに起きる）2 が空、3 が `en-US` で、
 * **«en-US だと観測できた» という嘘の結論**が出来上がる。呼び出し側はこれを真として
 * `describe.skip` を選ぶので、**ja-JP 前提の spec が黙って消える**。
 *
 * ⚠️ **skip は pass ではない。** 落ちないので誰も気づかず、緑のまま検証範囲だけが縮む。
 * だから «観測できたか» と «一致していたか» を分ける:
 * - **判定に使ってよいのは 1 の値だけ**。取れなければ null を返し、呼び出し側は skip しない
 *   （ロケールが本当に違えば ja-JP の文言セレクタが落ちる。**黙って消えるより落ちる方が正しい**）
 * - 2 / 3 は人間が原因を追うための **診断表示専用**（{@link describeAndroidLocaleProps}）
 * - 1 は adbd の一瞬の不通で落ちうるので、**数回試す**（`e2e-mobile/scripts/setup-android-locale.sh`
 *   の `adb_retry` と同じ形。あちらは «接続断で落ちうる adb» を、こちらは «観測» を守っている）
 *
 * ## ⚠️ #1579 【バグ】その «数回試す» が、こんどは iOS を 3 時間半固めた
 *
 * 上の修正で入れた再試行は `adb wait-for-device` で再接続を待っていた。**あれには上限が無い。**
 * macOS ランナーには adb が在り、iOS の `device.id` は現れないシミュレータの UDID なので、
 * **`describeJapaneseLocale`（= 全 spec が import するモジュールの評価）で jest が固まった**。
 * 2026-09-30 の夜間 iOS は 2 シャードとも **1 suite も走らないまま** 240 分で打ち切られた。
 *
 * だから観測は 2 つの歯止めを持つ: **Android 以外では adb を 1 回も呼ばない**（{@link isAndroidDevice}）、
 * **adb の呼び出しには必ず上限を課す**（`utils/adb.ts`。経緯と CI のガードはそちらに書いてある）。
 */
export function getAndroidRuntimeLocale(attempts = LOCALE_OBSERVE_ATTEMPTS): string | null {
	// ⚠️ #1579 Android 以外では adb を 1 回も呼ばない（理由は utils/adb.ts 冒頭）
	if (!isAndroidDevice()) return null;

	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		let output: string | null = null;
		try {
			output = adbSync(["shell", "am", "get-config"]);
		} catch {
			// adb が無い（ローカル）か、一瞬の不通。どちらもここでは区別せず次の試行へ
			output = null;
		}

		const parsed = parseLocaleFromAmGetConfig(output);
		if (parsed) return parsed;

		if (attempt < attempts) {
			try {
				// 不通が原因なら、再接続を待つのが一番短い。online なら即座に返る。
				// ⚠️ #1579 `wait-for-device` は **上限を持たない**サブコマンドなので、
				//    上限を明示する（既定の 30 秒は «観測の再試行» には長すぎる）
				adbSync(["wait-for-device"], { timeoutMs: LOCALE_WAIT_FOR_DEVICE_MS });
			} catch {
				// 観測用なので、待てなくても黙って次の試行へ
			}
			sleepSync(LOCALE_OBSERVE_RETRY_MS);
		}
	}
	return null;
}

/**
 * 原因追跡用に、ロケール関連の property を 1 行へまとめる。
 *
 * ⚠️ **ここで読む値を判定へ使ってはいけない**（理由は {@link getAndroidRuntimeLocale}）。
 * `persist.sys.locale` は «設定した記録» であって «いま効いている値» ではなく、
 * `ro.product.locale` は AVD の作りつけの値である。
 */
export function describeAndroidLocaleProps(): string {
	const read = (prop: string): string => {
		try {
			return adbSync(["shell", "getprop", prop]) || "(空)";
		} catch {
			return "(読めず)";
		}
	};
	return `persist.sys.locale=${read("persist.sys.locale")} ro.product.locale=${read("ro.product.locale")}`;
}

/**
 * Android エミュレータのシステムロケールを ja-JP に設定する。
 *
 * ⚠️ `persist.sys.locale` の変更は Android のランタイム再起動を伴うため **数十秒かかる**。
 * CI では「エミュレータ起動直後に 1 回だけ」実行するのが正しい使い方で、
 * spec から毎回呼ぶことは想定していない（#1029 のワークフロー側で実行する）。
 *
 * @returns 設定を実行できた場合 true / adb が使えない等で実行できなかった場合 false
 */
export function setAndroidSystemLocale(): boolean {
	try {
		adbSync(["shell", "setprop", "persist.sys.locale", E2E_LOCALE]);
		// #1031 【設計】プロパティを反映させるには Android のランタイム（zygote）再起動が必要。
		// `stop; start` 相当を ctl.restart で行う（adb root を必要としないため CI のエミュレータでも通る）
		adbSync(["shell", "setprop", "ctl.restart", "zygote"]);
		return true;
	} catch {
		return false;
	}
}

/**
 * 現在のデバイスが ja-JP ロケールで動いていることを確認する（Android 専用・非致命）。
 *
 * #1031 【設計】ロケール不一致は「テストは緑だが検証内容が嘘」という最悪の壊れ方をするため、
 * 起動時に必ず警告を出して気付けるようにする。ただしロケール設定は CI ワークフロー（#1029）と
 * AVD の責務なので、ここで例外を投げてテストを止めることはしない（責任分界を跨がない）。
 *
 * #1579 【バグ】**«観測できなかった» と «ja-JP ではなかった» を別の文言で出す。**
 * 混ぜて «現在: 取得不可» と書いていたせいで、同じ run に «取得不可» と «en-US» が並んでいても
 * 「ロケールが壊れている」と読めてしまい、真因（観測の失敗）へ辿り着けなかった。
 *
 * @returns **«ja-JP ではない» と観測できたときだけ** false。観測できなかった場合は true
 *   （観測の失敗を不一致として数えない。呼び出し側は戻り値を使っていないが、意味を固定しておく）
 */
export function warnIfAndroidLocaleMismatch(): boolean {
	const runtime = getAndroidRuntimeLocale();
	if (runtime === E2E_LOCALE) return true;

	if (runtime === null) {
		console.warn(
			[
				`⚠️ Android の実行時ロケールを観測できませんでした（am get-config が ${LOCALE_OBSERVE_ATTEMPTS} 回とも空）。`,
				"  iOS / adb 不在なら正常です。Android CI で出ているなら #1579 の観測失敗です。",
				`  診断: ${describeAndroidLocaleProps()}`,
				"  ⚠️ 観測できなかっただけなので «ロケールが違う» とは判定しません（skip もしません）。",
			].join("\n"),
		);
		return true;
	}

	console.warn(
		[
			`⚠️ Android デバイスのロケールが ${E2E_LOCALE} ではありません（実行時ロケール: ${runtime}）。`,
			"  ja-JP 前提のシナリオ（チュートリアル表示・日本語文言セレクタ）が再現しない可能性があります。",
			`  診断: ${describeAndroidLocaleProps()}`,
			"  エミュレータ起動後に次を実行してください:",
			`    adb shell setprop persist.sys.locale ${E2E_LOCALE} && adb shell setprop ctl.restart zygote`,
		].join("\n"),
	);
	return false;
}

/** 同期的に待つ（観測の再試行の間隔用。テスト実行前の 1 回だけなので async 化しない） */
function sleepSync(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
