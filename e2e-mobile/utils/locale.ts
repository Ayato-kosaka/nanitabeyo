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

/**
 * #1579 【バグ】**`persist.sys.locale` を見てはいけない。**
 *
 * これを見ていたせいで、**端末が ja-JP なのに ja-JP 前提の spec が黙って skip されていた**。
 * 同じ run のログに両方が並んで出ている（[run 34453015222](https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/34453015222)）:
 *
 *     ▶ 実行時 configuration: config: mcc310-mnc260-ja-rJP-ldltr-...   ← 端末は ja-JP
 *     ⚠️ Android ロケールが ja-JP ではない（現在: en-US）ため … skip します
 *
 * `persist.sys.locale` は root でしか書けない保護プロパティで、エミュレータを
 * `-no-snapshot-save` で回している CI では **テスト実行時に空へ戻っていることがある**。
 * 空だと `||` が `ro.product.locale`（AVD のビルド値 = `en-US`）へ落ちる。
 * 一方 **LocaleList（実行時 configuration）は zygote 再起動時に効いたまま**なので、
 * アプリは日本語で描かれている。**プロパティは «設定した記録» であって «いま効いている値» ではない。**
 *
 * ⚠️ skip は pass ではない。#1579 で潰してきた «落ちないテスト» と同じ害があり、
 * しかも skip は失敗すら出さないぶん見つけにくい。
 */
export function getAndroidSystemLocale(): string | null {
	try {
		// 1. アプリが実際に使う値（LocaleList）を最優先で見る
		const fromRuntime = parseLocaleFromAmGetConfig(adb(["shell", "am", "get-config"]));
		if (fromRuntime) return fromRuntime;

		// 2. 取れなければ従来どおり。⚠️ ro.product.locale は «AVD の作りつけの値» なので
		//    «設定が効いていない» ことの証拠にはなっても «効いている» の証拠にはならない
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
