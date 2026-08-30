import { strict as assert } from "node:assert";

import { describeJapaneseLocale, device, launchAppWithSession } from "../../fixtures/e2e";
import { LanguageScreen } from "../../screens/LanguageScreen";
import { ProfileScreen } from "../../screens/ProfileScreen";
import { SettingsScreen } from "../../screens/SettingsScreen";
import { TabBar } from "../../screens/TabBar";

/**
 * 🌐 アプリ内での表示言語の切り替え（SET-06 / #1508）
 *
 * e2e-web の tests/profile/language-switch.spec.ts に対応する。
 *
 * 設定 → 言語 で表示言語を選ぶと、端末のロケールに関わらず選んだ言語で UI が描画され、
 * その選択は AsyncStorage に残って次回起動時のロケールになる。
 *
 * ## Web 版からの変更点
 * - **導線**: e2e-web は `page.goto("/ja-JP/profile/language")` で URL 直遷移するが、
 *   ネイティブには代替経路が無いため、マイページ → 歯車 → 「言語」行、と実 UI をタップして遷移する
 *   （tests/profile/settings.test.ts と同じ方針）。
 * - **「次回起動時のリダイレクト先になる」ケースは移植していない**。web はページを読み込み直せば
 *   済むが、ネイティブで同じことをすると **端末に ja-JP 以外の言語設定が残ったまま次の spec へ渡る**
 *   危険がある（下の afterAll の注記を参照）。起動時の解決そのものは
 *   `app-expo/features/settings/languagePreferenceStore.test.ts` と `app/index.tsx` の分岐で担保する。
 * - **ar-SA の「無いこと」**: Playwright は `toHaveCount(0)` で書けるが、Detox の `by.text()` は
 *   完全一致しか無いため、ネイティブ名（`العربية`）の完全一致文字列が存在しないことで代替する。
 *
 * ## ⚠️ この spec は端末に状態を残す
 * 言語設定は AsyncStorage（`language_preference_v1`）に永続化されるため、途中で失敗して
 * ko-KR のまま終わると **後続の全 spec が韓国語で起動し**、日本語文言セレクタが軒並み落ちる。
 * それを避けるため、
 * 1. 切り替えのテストは最後に必ず「端末の設定に従う」へ戻す（＝保存値を削除する）
 * 2. それでも途中失敗はありうるので、`afterAll` でアプリのストレージごと消す
 * の二段構えにしている。
 */

/** locales/*.json の `Settings.language.pageTitle` */
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

/** RTL 未対応のため選択肢から外している言語（`constants/languageDisplayNames.ts` のネイティブ名） */
const EXCLUDED_RTL_LOCALE = "ar-SA";
const EXCLUDED_RTL_LABEL = "العربية";

/** 選択肢に出るべき公開ロケール（`PUBLIC_LOCALES` から RTL を除いたもの） */
const SELECTABLE_LOCALES = ["ja-JP", "en-US", "fr-FR", "zh-CN", "ko-KR", "es-ES", "hi-IN"];

describeJapaneseLocale("表示言語の切り替え(#1508)", () => {
	// #1031 【バグ】beforeAll だと前のテストが残した画面状態（開いたままのモーダル等）を次が引き継ぎ、
	// タップがオーバーレイに阻まれて落ちる。セッション注入起動は匿名クォータを消費しないため、
	// テストごとに起動し直して独立性を担保する
	beforeEach(async () => {
		await launchAppWithSession({ as: "anon" });
	});

	// ⚠️ 端末に残った `language_preference_v1` を確実に消してから次の spec へ渡す。
	// `resetAppState()` は iOS では高コスト（#1030 m-5）だが、**この spec ファイルにつき 1 回**で済む。
	// 払う価値はある: 消し忘れると後続の spec が「テストは走るが全部別言語」という、
	// 原因が最も分かりにくい壊れ方をする。
	afterAll(async () => {
		await device.resetAppState();
	});

	// ─ テストケース: 設定メニューから言語画面へ入れる ─
	// 手順:
	//   1. マイページタブ → 歯車 → 「言語」行、の実導線で言語画面へ遷移する
	//   2. ヘッダー（language-header-title）が「言語」であることを検証
	//   3. 「端末の設定に従う」行が日本語で出ていることを検証
	it("設定メニューの「言語」から言語画面へ遷移できる", async () => {
		const tabBar = new TabBar();
		const profileScreen = new ProfileScreen();
		const settingsScreen = new SettingsScreen();
		const languageScreen = new LanguageScreen();

		// #1402 で独立した設定画面は廃止され、設定項目はマイページ本体へ統合された。
		// 「マイページを開けば設定項目が同じ画面に居る」ので 1 階層減っている（theme.test.ts と同じ形）。
		await tabBar.gotoProfile();
		await profileScreen.expectLoaded();
		await settingsScreen.expectLoaded();
		await settingsScreen.openLanguage();

		await languageScreen.expectLoaded();
		await languageScreen.expectHeaderTitle(PAGE_TITLE["ja-JP"]);
		await languageScreen.expectSystemOptionLabel(SYSTEM_DEFAULT_LABEL["ja-JP"]);
	});

	// ─ テストケース: RTL 未対応のため ar-SA が選択肢に出ない ─
	// 手順:
	//   1. 言語画面へ遷移する
	//   2. language-option-ar-SA が存在しないことを検証（これが本題）
	//   3. アラビア語のネイティブ名「العربية」も画面に出ていないことを検証
	//      （testID だけ消してラベルが残る、の取りこぼしを防ぐ）
	//   4. 残りの公開ロケール 7 件がすべて出ていることを検証（除外しすぎの検知）
	//
	// この画面は **状態を変えない**（何も選ばない）ので、後始末は不要。
	it("RTL 未対応のため ar-SA が選択肢に出ない", async () => {
		const tabBar = new TabBar();
		const profileScreen = new ProfileScreen();
		const settingsScreen = new SettingsScreen();
		const languageScreen = new LanguageScreen();

		// #1402 で独立した設定画面は廃止され、設定項目はマイページ本体へ統合された。
		// 「マイページを開けば設定項目が同じ画面に居る」ので 1 階層減っている（theme.test.ts と同じ形）。
		await tabBar.gotoProfile();
		await profileScreen.expectLoaded();
		await settingsScreen.expectLoaded();
		await settingsScreen.openLanguage();
		await languageScreen.expectLoaded();

		const hasArabicOption = await languageScreen.hasOption(EXCLUDED_RTL_LOCALE);
		assert.equal(hasArabicOption, false, `RTL 未対応のため language-option-${EXCLUDED_RTL_LOCALE} は出ないはず`);

		const hasArabicLabel = await languageScreen.hasText(EXCLUDED_RTL_LABEL);
		assert.equal(hasArabicLabel, false, `選択肢から外した言語のネイティブ名「${EXCLUDED_RTL_LABEL}」が画面に残っている`);

		for (const locale of SELECTABLE_LOCALES) {
			const hasOption = await languageScreen.hasOption(locale);
			assert.equal(hasOption, true, `language-option-${locale} が選択肢に出ていない`);
		}
	});

	// ─ テストケース: 日本語 → English → 한국어 と続けて切り替わる ─
	// 手順:
	//   1. 言語画面へ遷移する（日本語）
	//   2. English を選ぶ → ヘッダーが "Language"、1 行目が "Use device language" になることを検証
	//   3. 한국어 を選ぶ → ヘッダーが "언어"、1 行目が "기기 설정을 따름" になることを検証
	//   4. 「기기 설정을 따름」を選ぶ → 端末ロケール（ja-JP）へ戻ることを検証（＝後始末を兼ねる）
	//
	// ⚠️ 3 回続けて切り替えるのが要点。1 回だけだと「初期ロケールの決定」と「切り替え」の
	//    区別が付かず、2 回目以降で壊れる実装（例: 切り替え中の状態を戻し忘れて操作を受け付けなくなる）を
	//    素通ししてしまう。
	it("日本語 → English → 한국어 と続けて切り替えると画面の文言が追随する", async () => {
		const tabBar = new TabBar();
		const profileScreen = new ProfileScreen();
		const settingsScreen = new SettingsScreen();
		const languageScreen = new LanguageScreen();

		// #1402 で独立した設定画面は廃止され、設定項目はマイページ本体へ統合された。
		// 「マイページを開けば設定項目が同じ画面に居る」ので 1 階層減っている（theme.test.ts と同じ形）。
		await tabBar.gotoProfile();
		await profileScreen.expectLoaded();
		await settingsScreen.expectLoaded();
		await settingsScreen.openLanguage();
		await languageScreen.expectLoaded();
		await languageScreen.expectHeaderTitle(PAGE_TITLE["ja-JP"]);

		// 1 回目: 日本語 → 英語
		await languageScreen.select("en-US");
		await languageScreen.expectHeaderTitle(PAGE_TITLE["en-US"]);
		await languageScreen.expectSystemOptionLabel(SYSTEM_DEFAULT_LABEL["en-US"]);

		// 2 回目: 英語 → 韓国語
		await languageScreen.select("ko-KR");
		await languageScreen.expectHeaderTitle(PAGE_TITLE["ko-KR"]);
		await languageScreen.expectSystemOptionLabel(SYSTEM_DEFAULT_LABEL["ko-KR"]);

		// 3 回目: 韓国語 → 端末の設定に従う（= ja-JP へ戻る）。
		// ⚠️ この行は後始末そのもの。消すと端末に韓国語設定が残り、後続の spec を巻き込む
		await languageScreen.select("system");
		await languageScreen.expectHeaderTitle(PAGE_TITLE["ja-JP"]);
		await languageScreen.expectSystemOptionLabel(SYSTEM_DEFAULT_LABEL["ja-JP"]);
	});
});
