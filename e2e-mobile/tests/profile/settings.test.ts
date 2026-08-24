import { strict as assert } from "node:assert";

import { launchAppWithSession, waitUntilVisible } from "../../fixtures/e2e";
import { TabBar } from "../../screens/TabBar";
import { ProfileScreen } from "../../screens/ProfileScreen";
import { SettingsScreen } from "../../screens/SettingsScreen";
import { LegalScreen } from "../../screens/LegalScreen";

/**
 * ⚙️ 設定項目（匿名ユーザー）のテスト（e2e-web の tests/profile/settings.spec.ts に対応）
 *
 * 目的: 設定メニューの項目構成と、匿名ユーザーへの表示制御を保証する。
 * 表示・遷移の検証に留め、フィードバック送信・アカウント削除等の共有 dev 環境へ書き込む操作は行わない。
 *
 * ## #1402 で入口が変わった
 * 独立した設定画面（profile/settings.tsx）は無くなり、項目はマイページの縦リストへ統合された。
 * 歯車ボタン（profile-settings-button）も消えたので、マイページタブを開けばそこが設定である。
 * 見るもの（項目の構成・匿名時のログアウト非表示）は変わらないので、この spec はそのまま残す。
 *
 * ## Web 版からの変更点（#1031 確定）
 * - 「レビューを書く」（settings-leave-review）は Web では非表示だが、ネイティブでは表示される
 *   （`Platform.OS !== "web"` 条件、#1031 §1-1 の反転）。表示のみ検証し、タップはしない（M2: ストア誘導の
 *   Linking.openURL が実際に走ってしまうため）。
 */
describe("設定項目（匿名ユーザー）", () => {
	// #1031 【バグ】beforeAll だと前のテストが残した画面状態(開いたままのモーダル等)を次が引き継ぎ、
	// タップがオーバーレイに阻まれて落ちる。セッション注入起動は匿名クォータを消費しないため
	// (fixtures/e2e.ts の launchAppWithSession)、テストごとに起動し直して独立性を担保する
	beforeEach(async () => {
		await launchAppWithSession({ as: "anon" });
	});

	// ─ テストケース: 設定メニューの各項目が表示される ─
	// 手順:
	//   1. マイページタブを開く（#1402 以前は「歯車ボタンをタップして設定画面へ」だった）
	//   2. 以下の項目が表示されることを検証:
	//      - ご意見・不具合(settings-feedback) / レビューを書く(settings-leave-review、ネイティブのみ)
	//      - ブロック済みの料理トピック(settings-blocked-dish-categories) / 利用規約(settings-terms)
	//      - プライバシーポリシー(settings-privacy)
	it("設定メニューの各項目が表示される", async () => {
		const tabBar = new TabBar();
		const profileScreen = new ProfileScreen();
		const settingsScreen = new SettingsScreen();

		await tabBar.gotoProfile();
		await profileScreen.expectLoaded();
		await settingsScreen.expectLoaded();

		await waitUntilVisible(settingsScreen.feedbackItem);
		await waitUntilVisible(settingsScreen.leaveReviewItem);
		await waitUntilVisible(settingsScreen.blockedDishCategoriesItem);
		await waitUntilVisible(settingsScreen.termsItem);
		await waitUntilVisible(settingsScreen.privacyItem);
	});

	// ─ テストケース: プライバシーポリシー行で法務ドキュメント画面へ遷移する ─
	// 手順:
	//   1. マイページを表示する
	//   2. プライバシーポリシー行（settings-privacy）をタップする
	//   3. 法務ドキュメント画面（legal-screen-document）が表示されることを検証
	//
	// #1027 この検証はもともと #1031 B2 でログインモーダルの同意文言リンクに置く予定だったが、
	// リンクは `<Text>` の入れ子でネイティブ View を持たず Detox から到達できないことが実測で判明した
	// （screens/LoginScreen.ts のコメント参照）。実体のある行を持つこちらの画面へ移してある。
	// #1368 遷移先は BlurModal（legal-document-modal）から `/[locale]/legal/privacy` ルートへ変わった。
	// 戻る導線まで含めた検証は tests/profile/legal.test.ts が持つ。
	it("プライバシーポリシー行で法務ドキュメント画面へ遷移する", async () => {
		const tabBar = new TabBar();
		const settingsScreen = new SettingsScreen();
		const legalScreen = new LegalScreen();

		await tabBar.gotoProfile();
		await settingsScreen.expectLoaded();

		await settingsScreen.openPrivacyPolicy();
		await legalScreen.expectOpened();
	});

	// ─ テストケース: 匿名時はログアウトが表示されない ─
	// 手順:
	//   1. マイページを表示する（匿名状態）
	//   2. ログアウト行（settings-logout）が存在しないことを検証
	//      （ログアウトは非匿名ユーザーのみに表示される仕様）
	it("匿名時はログアウトが表示されない", async () => {
		const tabBar = new TabBar();
		const settingsScreen = new SettingsScreen();

		await tabBar.gotoProfile();
		await settingsScreen.expectLoaded();

		const hasLogoutItem = await settingsScreen.hasLogoutItem();
		assert.equal(hasLogoutItem, false, "匿名ユーザーには settings-logout が表示されないはず");
	});
});
