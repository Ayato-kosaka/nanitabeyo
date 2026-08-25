import { strict as assert } from "node:assert";

import { launchAppWithSession, waitUntilVisible } from "../../fixtures/e2e";
import { TabBar } from "../../screens/TabBar";
import { ProfileScreen } from "../../screens/ProfileScreen";
import { SettingsScreen } from "../../screens/SettingsScreen";
import { LegalScreen } from "../../screens/LegalScreen";
import { NotificationSettingsSection } from "../../screens/NotificationSettingsSection";

/**
 * ⚙️ 設定画面（匿名ユーザー）のテスト（e2e-web の tests/profile/settings.spec.ts に対応）
 *
 * 目的: 設定メニューの項目構成と、匿名ユーザーへの表示制御を保証する。
 * 表示・遷移の検証に留め、フィードバック送信・アカウント削除等の共有 dev 環境へ書き込む操作は行わない。
 *
 * ## Web 版からの変更点（#1031 確定）
 * - e2e-web は `page.goto("/ja-JP/profile/settings")` で URL 直遷移するが、ネイティブには
 *   その代替経路が無いため、マイページの歯車ボタン（profile-settings-button）を実際にタップして遷移する。
 * - 「なに食べよ を応援する」（settings-leave-review。#1583 で「レビューを書く」から改称）は
 *   Web では非表示だが、ネイティブでは表示される（`Platform.OS !== "web"` 条件、#1031 §1-1 の反転）。
 *   表示のみ検証し、タップはしない（M2: ストア誘導の Linking.openURL が実際に走ってしまうため）。
 * - #1583 で設定は 3 画面に割れた。応援する・規約 4 行は «なに食べよについて»、
 *   表示テーマは «端末設定» にある。設定画面を開いただけでは見えない。
 */
describe("設定画面（匿名ユーザー）", () => {
	// #1031 【バグ】beforeAll だと前のテストが残した画面状態(開いたままのモーダル等)を次が引き継ぎ、
	// タップがオーバーレイに阻まれて落ちる。セッション注入起動は匿名クォータを消費しないため
	// (fixtures/e2e.ts の launchAppWithSession)、テストごとに起動し直して独立性を担保する
	beforeEach(async () => {
		await launchAppWithSession({ as: "anon" });
	});

	// ─ テストケース: 設定メニューの各項目が表示される ─
	// 手順:
	//   1. マイページタブ→歯車ボタンの実導線で設定画面へ遷移する
	//   2. 以下の項目が表示されることを検証:
	//      - ご意見・不具合(settings-feedback) / ブロック済みの料理トピック(settings-blocked-topics)
	//      - 端末設定(settings-device-settings) / なに食べよについて(settings-about) ← #1583 で新設
	it("設定メニューの各項目が表示される", async () => {
		const tabBar = new TabBar();
		const profileScreen = new ProfileScreen();
		const settingsScreen = new SettingsScreen();

		await tabBar.gotoProfile();
		await profileScreen.gotoSettings();
		await settingsScreen.expectLoaded();

		await waitUntilVisible(settingsScreen.feedbackItem);
		await waitUntilVisible(settingsScreen.blockedTopicsItem);
		// #1583 ページへ送る 2 行
		await waitUntilVisible(settingsScreen.deviceSettingsItem);
		await waitUntilVisible(settingsScreen.aboutItem);
	});

	// ─ テストケース: «なに食べよについて» に応援する・規約・バージョンが揃う ─
	// #1583 オーナー指定の中身。**«応援する» はネイティブでしか出ない**ので、
	// この 1 本は web 側では代替できない（e2e-web は行が無いことを検証している）。
	// 手順:
	//   1. 設定画面から「なに食べよについて」行をタップする
	//   2. 応援する / 規約 4 行 / バージョン行が表示されることを検証
	it("«なに食べよについて» に応援する・規約・バージョンが揃う", async () => {
		const tabBar = new TabBar();
		const profileScreen = new ProfileScreen();
		const settingsScreen = new SettingsScreen();

		await tabBar.gotoProfile();
		await profileScreen.gotoSettings();
		await settingsScreen.expectLoaded();
		await settingsScreen.openAbout();

		await waitUntilVisible(settingsScreen.leaveReviewItem);
		await waitUntilVisible(settingsScreen.guidelinesItem);
		await waitUntilVisible(settingsScreen.termsItem);
		await waitUntilVisible(settingsScreen.privacyItem);
		await waitUntilVisible(settingsScreen.copyrightItem);
		await waitUntilVisible(settingsScreen.versionRow);
	});

	// ─ テストケース: プライバシーポリシー行で法務ドキュメント画面へ遷移する ─
	// 手順:
	//   1. 設定画面を表示する
	//   2. «なに食べよについて» へ移動し、プライバシーポリシー行（settings-privacy）をタップする（#1583）
	//   3. 法務ドキュメント画面（legal-screen-document）が表示されることを検証
	//
	// #1027 この検証はもともと #1031 B2 でログインモーダルの同意文言リンクに置く予定だったが、
	// リンクは `<Text>` の入れ子でネイティブ View を持たず Detox から到達できないことが実測で判明した
	// （screens/LoginScreen.ts のコメント参照）。実体のある行を持つこちらの画面へ移してある。
	// #1368 遷移先は BlurModal（legal-document-modal）から `/[locale]/legal/privacy` ルートへ変わった。
	// 戻る導線まで含めた検証は tests/profile/legal.test.ts が持つ。
	it("プライバシーポリシー行で法務ドキュメント画面へ遷移する", async () => {
		const tabBar = new TabBar();
		const profileScreen = new ProfileScreen();
		const settingsScreen = new SettingsScreen();
		const legalScreen = new LegalScreen();

		await tabBar.gotoProfile();
		await profileScreen.gotoSettings();
		await settingsScreen.expectLoaded();

		await settingsScreen.openPrivacyPolicy();
		await legalScreen.expectOpened();
	});

	// ─ テストケース: 匿名時はログアウトが表示されない ─
	// 手順:
	//   1. 設定画面を表示する（匿名状態）
	//   2. ログアウト行（settings-logout）が存在しないことを検証
	//      （ログアウトは非匿名ユーザーのみに表示される仕様）
	it("匿名時はログアウトが表示されない", async () => {
		const tabBar = new TabBar();
		const profileScreen = new ProfileScreen();
		const settingsScreen = new SettingsScreen();

		await tabBar.gotoProfile();
		await profileScreen.gotoSettings();
		await settingsScreen.expectLoaded();

		const hasLogoutItem = await settingsScreen.hasLogoutItem();
		assert.equal(hasLogoutItem, false, "匿名ユーザーには settings-logout が表示されないはず");
	});

	// ─ テストケース: 匿名時は通知カテゴリのカードが表示されない ─
	// 手順:
	//   1. 設定画面を表示する（匿名状態）
	//   2. 通知カード（settings-notifications-card）が存在しないことを検証
	//
	// #1510 匿名ユーザーは Push Token を登録しない（PushTokenRegistration）ため、
	// 受け取り方を設定させても届く先が無い。ログイン済み側（3 カテゴリのトグルが出る）は
	// tests/authenticated/notification-preferences.test.ts が検証する
	it("匿名時は通知カテゴリのカードが表示されない", async () => {
		const tabBar = new TabBar();
		const profileScreen = new ProfileScreen();
		const settingsScreen = new SettingsScreen();
		const section = new NotificationSettingsSection();

		await tabBar.gotoProfile();
		await profileScreen.gotoSettings();
		await settingsScreen.expectLoaded();

		const hasNotificationCard = await section.exists();
		assert.equal(
			hasNotificationCard,
			false,
			"匿名ユーザーには settings-notifications-card が表示されないはず",
		);
	});
});
