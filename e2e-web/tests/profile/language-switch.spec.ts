import { PUBLIC_LOCALES } from "@shared/api/v1/constants/publicLocales";

import { test, expect } from "../../fixtures/test";
import { LanguagePage } from "../../pages/LanguagePage";
import { SettingsPage } from "../../pages/SettingsPage";

/**
 * 🌐 アプリ内での表示言語の切り替え（SET-06 / #1508）
 *
 * 設定 → 言語 で表示言語を選ぶと、
 * 1. 端末（ブラウザ）のロケールに関わらず、選んだ言語で UI が描画される
 * 2. URL のロケールセグメントが差し替わる（`lib/localeSwitch.ts`）
 * 3. 選択は AsyncStorage（Web では localStorage）へ残り、次回起動時のリダイレクト先になる
 *    （`app/index.tsx` の `loadLanguagePreference()`）
 *
 * ## なぜ E2E で守るのか
 * この機能の本体は「**保存 → 起動時リダイレクト → i18n の再評価 → 再ナビゲート**」という
 * 4 つの層をまたぐ配線で、どこか 1 本外れても各層のユニットテストは通ってしまう。
 * 特に 3.（再訪時に選んだ言語で起動する）は、実際にページを読み込み直さないと再現しない。
 *
 * ## ar-SA（RTL）を選択肢から外していることについて
 * このリポジトリは RTL レイアウトに未対応（`I18nManager` の使用が 0 件）で、
 * `ar-SA` を選ぶと「テキストは右から左・レイアウトは左から右」の崩れた画面になる。
 * そのため #1508 では **RTL 言語を選択肢から除外**する方針をオーナー承認済みで採った
 * （`app-expo/lib/rtlLocales.ts`。RTL 対応が入ったらこの除外を外す）。
 * 除外は「`ar-SA` 決め打ち」ではなく「RTL 判定」で行っているが、
 * 公開ロケールに現存する RTL 言語は `ar-SA` だけなので、ここでは `ar-SA` で検証する。
 *
 * ⚠️ `/ar-SA/...` へ **URL 直遷移する経路は塞いでいない**（共有リンク・既存の SEO ページが
 * その URL を持つため）。塞いだのはあくまで「アプリ内の言語選択 UI から選べること」。
 * 既存の `tests/profile/blocked-categories-wording.spec.ts` が `/ar-SA/...` を開いているのは
 * そのため矛盾ではない。
 */

/** locales/*.json の `Settings.language.pageTitle`。切り替わったことの観測点になる */
const PAGE_TITLE = {
	"ja-JP": "言語",
	"en-US": "Language",
	"ko-KR": "언어",
} as const;

/** locales/*.json の `Settings.language.systemDefault`（画面の 1 行目のラベル） */
const SYSTEM_DEFAULT_LABEL = {
	"ja-JP": "端末の設定に従う",
	"en-US": "Use device language",
	"ko-KR": "기기 설정을 따름",
} as const;

/**
 * 選択肢に出るべきロケール = 公開ロケールから RTL（`ar-SA`）を除いたもの。
 *
 * ⚠️ 判定の正は `app-expo/lib/rtlLocales.ts` にあるが、e2e-web の tsconfig の paths は
 * `@shared/*` だけなので app-expo のモジュールは import できない。ここでは
 * **`PUBLIC_LOCALES` から引き算する**形にしてあり、公開ロケールが増えたら
 * 自動的に「選択肢に出ること」を要求する（増やしたのに UI へ出ていなければ落ちる）。
 */
const RTL_PUBLIC_LOCALES = ["ar-SA"];
const SELECTABLE_LOCALES = PUBLIC_LOCALES.filter((locale) => !RTL_PUBLIC_LOCALES.includes(locale));

test.describe("表示言語の切り替え(#1508)", () => {
	// ─ テストケース: 設定メニューから言語画面へ入れる ─
	// 手順:
	//   1. /ja-JP/profile を開く
	//   2. 「端末設定」を開く（#1629 で「言語」はこの先へ移った）
	//   3. 「言語」行（settings-language）が表示されていることを検証
	//   4. タップして言語画面（language-header-title = 「言語」）へ遷移することを検証
	test("端末設定の「言語」から言語画面へ遷移できる", async ({ appPage }) => {
		const settingsPage = new SettingsPage(appPage);
		const languagePage = new LanguagePage(appPage);

		await settingsPage.goto();
		await settingsPage.expectLoaded();
		// #1629 マイページ直下には無い。«端末設定» の 1 ブロック目の先頭行になった
		await expect(settingsPage.languageItem).toHaveCount(0);
		await settingsPage.openDeviceSettings();
		await expect(settingsPage.languageItem).toBeVisible();

		await settingsPage.languageItem.click();
		await appPage.waitForURL(/\/ja-JP\/profile\/language/);
		await languagePage.expectLoaded(PAGE_TITLE["ja-JP"]);
	});

	// ─ テストケース: 日本語 → 英語 → 韓国語 と続けて切り替わる ─
	// 手順:
	//   1. /ja-JP/profile/language を開き、日本語の文言が出ていることを確認する
	//   2. English を選ぶ → URL が /en-US になり、文言が英語になることを検証
	//   3. 한국어 を選ぶ → URL が /ko-KR になり、文言が韓国語になることを検証
	//   4. 「기기 설정을 따름」(端末の設定に従う) を選ぶ → ブラウザロケール(ja-JP)へ戻ることを検証
	//
	// ⚠️ 3 回続けて切り替えるのが要点。1 回だけだと「初期ロケールの決定」と
	//    「切り替え」の区別が付かず、2 回目以降で壊れる実装（例: preference を
	//    読み込んだきり更新しない）を素通ししてしまう。
	test("日本語 → English → 한국어 と続けて切り替えると画面の文言が追随する", async ({ appPage }) => {
		const languagePage = new LanguagePage(appPage);

		await languagePage.goto("ja-JP");
		await languagePage.expectLoaded(PAGE_TITLE["ja-JP"]);
		await expect(languagePage.option("system")).toHaveText(SYSTEM_DEFAULT_LABEL["ja-JP"]);

		// 1 回目: 日本語 → 英語
		await languagePage.select("en-US", "en-US");
		await languagePage.expectLoaded(PAGE_TITLE["en-US"]);
		await expect(languagePage.option("system")).toHaveText(SYSTEM_DEFAULT_LABEL["en-US"]);

		// 2 回目: 英語 → 韓国語（英語 UI からでも選択肢のラベルはネイティブ名のまま）
		await expect(languagePage.option("ko-KR")).toHaveText("한국어");
		await languagePage.select("ko-KR", "ko-KR");
		await languagePage.expectLoaded(PAGE_TITLE["ko-KR"]);
		await expect(languagePage.option("system")).toHaveText(SYSTEM_DEFAULT_LABEL["ko-KR"]);

		// 3 回目: 韓国語 → 端末の設定に従う（= ブラウザの ja-JP へ戻る）
		await languagePage.select("system", "ja-JP");
		await languagePage.expectLoaded(PAGE_TITLE["ja-JP"]);
		await expect(languagePage.option("system")).toHaveText(SYSTEM_DEFAULT_LABEL["ja-JP"]);
	});

	// ─ テストケース: RTL 未対応のため ar-SA が選択肢に出ない ─
	// 手順:
	//   1. /ja-JP/profile/language を開く
	//   2. language-option-ar-SA が 1 件も無いことを検証（これが本題）
	//   3. アラビア語のネイティブ名「العربية」も画面に出ていないことを検証
	//      （testID だけ消してラベルが残る、の取りこぼしを防ぐ）
	//   4. 残りの公開ロケール（7 件）＋「端末の設定に従う」がすべて出ていることを検証
	//      （除外しすぎ・出し忘れの検知）
	test("RTL 未対応のため ar-SA が選択肢に出ない", async ({ appPage }) => {
		const languagePage = new LanguagePage(appPage);

		await languagePage.goto("ja-JP");
		await languagePage.expectLoaded(PAGE_TITLE["ja-JP"]);

		await expect(languagePage.option("ar-SA")).toHaveCount(0);
		// constants/languageDisplayNames.ts の LANGUAGE_DISPLAY_NAMES["ar-SA"]
		await expect(appPage.getByText("العربية")).toHaveCount(0);

		for (const locale of SELECTABLE_LOCALES) {
			await expect(languagePage.option(locale), `${locale} が選択肢に出ていない`).toBeVisible();
		}
		await expect(languagePage.option("system")).toBeVisible();
		// 「端末の設定に従う」＋ RTL を除いた公開ロケール
		await expect(languagePage.options).toHaveCount(SELECTABLE_LOCALES.length + 1);
	});

	// ─ テストケース: 選んだ言語が次回起動時にも使われる ─
	// 手順:
	//   1. 言語画面で English を選ぶ
	//   2. ルート("/")を開き直す（= アプリの再起動相当）
	//   3. ブラウザロケールは ja-JP のままなのに /en-US へリダイレクトされることを検証
	//
	// これが app/index.tsx の変更（保存済み設定 > 端末ロケール）の本体。
	// 保存だけして起動時に読まない実装だと、ここだけが落ちる。
	test("選んだ言語は次回起動時のリダイレクト先になる", async ({ appPage }) => {
		const languagePage = new LanguagePage(appPage);

		await languagePage.goto("ja-JP");
		await languagePage.expectLoaded(PAGE_TITLE["ja-JP"]);
		await languagePage.select("en-US", "en-US");

		await appPage.goto("/");
		await appPage.waitForURL(/\/en-US(\/|$)/);
	});
});
