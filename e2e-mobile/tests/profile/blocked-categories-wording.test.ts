import { strict as assert } from "node:assert";

import { describeJapaneseLocale, launchAppWithSession, waitUntilVisible } from "../../fixtures/e2e";
import { BlockedTopicsScreen } from "../../screens/BlockedTopicsScreen";
import { ProfileScreen } from "../../screens/ProfileScreen";
import { SettingsScreen } from "../../screens/SettingsScreen";
import { TabBar } from "../../screens/TabBar";

/**
 * 🈁 ブロック済み料理カテゴリの文言（#1132）
 *
 * e2e-web の tests/profile/blocked-categories-wording.spec.ts に対応する。
 *
 * #1132 は「ブロック済み料理トピック」という文言が不自然だったため、
 * 8 言語分を「料理カテゴリ」へ統一した変更（PR #1148）。
 *
 * ## なぜ E2E で守るのか（web 側と同じ理由）
 * 文言の統一は locales/*.json の 8 ファイルへ散らばるので、1 ファイルだけ直し漏れても
 * 型検査もユニットテストも通ってしまう。「画面に旧文言が出ていないこと」は
 * 実際に描画しないと分からないため E2E で見る。
 *
 * ## Web 版からの変更点
 * - **導線**: e2e-web は `page.goto("/ja-JP/profile/blocked-topics")` で URL 直遷移するが、
 *   ネイティブには代替経路が無いため、マイページ → 歯車 → ブロック済み行、と実 UI をタップして遷移する
 *   （tests/profile/settings.test.ts と同じ方針）。
 * - **旧文言の残存チェック**: Playwright の `getByText("トピック")` は部分一致で
 *   「含む要素が 0 件」を直接書けるが、Detox の `by.text()` は **完全一致しか無い**。
 *   そのため #1132 以前の locales の値（`OLD_*`）を定数として持ち、
 *   **その完全一致文字列が存在しないこと**で代替する。直し漏れがあればそのまま一致して落ちる。
 * - **ar-SA(RTL) のケースは移植していない**。Detox のロケール指定は iOS が
 *   `launchApp({ languageAndLocale })`、Android が端末の `persist.sys.locale` と
 *   プラットフォームで別物で、しかも Android は起動時に切り替えられない（fixtures/e2e.ts の
 *   `platformLaunchOptions` / utils/locale.ts 参照）。**この spec だけのために CI の端末ロケールを
 *   動かすと他の全 spec を巻き込む**ため、多言語の担保は web 側と locales のユニットテストに委ねる。
 */

/** locales/ja-JP.json の `Settings.blockedTopics.pageTitle`（= navigationLabel と同値） */
const NEW_WORDING = "ブロック済みの料理カテゴリ";

/**
 * #1132 以前の `Settings.blockedTopics.pageTitle` / `navigationLabel`。
 * これが画面に出ていたら直し漏れ。**locales を戻さない限り一致しない**ので、
 * ここを直すのは「旧文言をもう一度変える」ときだけ。
 */
const OLD_WORDING = "ブロック済みの料理トピック";

describeJapaneseLocale("ブロック済み料理カテゴリの文言(#1132)", () => {
	// #1031 【バグ】beforeAll だと前のテストが残した画面状態（開いたままのモーダル等）を次が引き継ぎ、
	// タップがオーバーレイに阻まれて落ちる。セッション注入起動は匿名クォータを消費しないため、
	// テストごとに起動し直して独立性を担保する
	beforeEach(async () => {
		await launchAppWithSession({ as: "anon" });
	});

	// ─ テストケース: ja-JP で新文言が出て、旧文言が残っていない ─
	// 手順:
	//   1. マイページタブ → 歯車 → ブロック済み行、の実導線で一覧画面へ遷移する
	//   2. ScreenHeader のタイトル（blocked-topics-header-title）が
	//      「ブロック済みの料理カテゴリ」であることを検証
	//   3. 画面に旧文言「ブロック済みの料理トピック」が残っていないことを検証（これが #1132 の本体）
	it("ja-JP で「料理カテゴリ」と表示され、旧文言「トピック」が残っていない", async () => {
		const tabBar = new TabBar();
		const profileScreen = new ProfileScreen();
		const settingsScreen = new SettingsScreen();
		const blockedTopicsScreen = new BlockedTopicsScreen();

		await tabBar.gotoProfile();
		await profileScreen.gotoSettings();
		await settingsScreen.expectLoaded();
		await settingsScreen.openBlockedTopics();

		await blockedTopicsScreen.expectLoaded();
		// locales/ja-JP.json の Settings.blockedTopics.pageTitle と同じ文字列であること
		await blockedTopicsScreen.expectHeaderTitle(NEW_WORDING);

		// ⚠️ ここが本題。1 ファイルでも直し漏れると旧文言が画面へ出る
		const hasOldWording = await blockedTopicsScreen.hasText(OLD_WORDING);
		assert.equal(hasOldWording, false, `ブロック済み一覧に旧文言「${OLD_WORDING}」が残っている`);
	});

	// ─ テストケース: 設定メニューの導線も新文言になっている ─
	// 手順:
	//   1. マイページタブ → 歯車ボタンで設定画面へ遷移する
	//   2. ブロック済み項目（settings-blocked-topics）が表示されることを検証
	//   3. 設定画面にも旧文言が残っていないことを検証
	//      （pageTitle だけ直して navigationLabel を直し漏れる事故を防ぐ）
	it("設定メニューの導線にも旧文言が残っていない", async () => {
		const tabBar = new TabBar();
		const profileScreen = new ProfileScreen();
		const settingsScreen = new SettingsScreen();

		await tabBar.gotoProfile();
		await profileScreen.gotoSettings();
		await settingsScreen.expectLoaded();

		await waitUntilVisible(settingsScreen.blockedTopicsItem);

		const hasOldWording = await settingsScreen.hasText(OLD_WORDING);
		assert.equal(hasOldWording, false, `設定メニューの導線に旧文言「${OLD_WORDING}」が残っている`);
	});
});
