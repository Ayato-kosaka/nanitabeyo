import { execFileSync } from "node:child_process";

import { device } from "detox";

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
 * Android エミュレータの現在のシステムロケールを取得する。
 *
 * @returns 例: "ja-JP"。取得できなかった場合は null
 * @失敗時 adb の実行に失敗しても例外は投げず null を返す（ロケール検証は fail-fast させない方針）
 */
export function getAndroidSystemLocale(): string | null {
	try {
		return adb(["shell", "getprop", "persist.sys.locale"]) || adb(["shell", "getprop", "ro.product.locale"]) || null;
	} catch {
		return null;
	}
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
		adb(["shell", "setprop", "persist.sys.locale", E2E_LOCALE]);
		// #1031 【設計】プロパティを反映させるには Android のランタイム（zygote）再起動が必要。
		// `stop; start` 相当を ctl.restart で行う（adb root を必要としないため CI のエミュレータでも通る）
		adb(["shell", "setprop", "ctl.restart", "zygote"]);
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
 * @returns 一致していれば true
 */
export function warnIfAndroidLocaleMismatch(): boolean {
	const current = getAndroidSystemLocale();
	if (current === E2E_LOCALE) return true;

	console.warn(
		[
			`⚠️ Android デバイスのロケールが ${E2E_LOCALE} ではありません（現在: ${current ?? "取得不可"}）。`,
			"  ja-JP 前提のシナリオ（チュートリアル表示・日本語文言セレクタ）が再現しない可能性があります。",
			"  エミュレータ起動後に次を実行してください:",
			`    adb shell setprop persist.sys.locale ${E2E_LOCALE} && adb shell setprop ctl.restart zygote`,
		].join("\n"),
	);
	return false;
}

/**
 * 現在の Detox デバイスに対して adb コマンドを実行する。
 *
 * @param args adb のサブコマンド（`-s <deviceId>` は自動で前置する）
 * @returns 標準出力（前後の空白を除去したもの）
 * @失敗時 adb が見つからない / コマンドが失敗した場合は例外を投げる（呼び出し側で握り潰すこと）
 */
function adb(args: string[]): string {
	return execFileSync("adb", ["-s", device.id, ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	}).trim();
}
