import { strict as assert } from "node:assert";

import { element, expect, launchAppWithSession, waitUntilVisible } from "../../fixtures/e2e";
import { TabBar } from "../../screens/TabBar";
import { ProfileScreen } from "../../screens/ProfileScreen";
import { SettingsScreen } from "../../screens/SettingsScreen";
import { LegalScreen } from "../../screens/LegalScreen";

/**
 * ⚙️ 設定画面（匿名ユーザー）のテスト（e2e-web の tests/profile/settings.spec.ts に対応）
 *
 * 目的: 設定メニューの項目構成と、匿名ユーザーへの表示制御を保証する。
 * 表示・遷移の検証に留め、フィードバック送信・アカウント削除等の共有 dev 環境へ書き込む操作は行わない。
 *
 * ## Web 版からの変更点（#1031 確定）
 * - e2e-web は `page.goto("/ja-JP/profile/settings")` で URL 直遷移するが、ネイティブには
 *   その代替経路が無いため、マイページの歯車ボタン（profile-settings-button）を実際にタップして遷移する。
 * - 「レビューを書く」（settings-leave-review）は Web では非表示だが、ネイティブでは表示される
 *   （`Platform.OS !== "web"` 条件、#1031 §1-1 の反転）。表示のみ検証し、タップはしない（M2: ストア誘導の
 *   Linking.openURL が実際に走ってしまうため）。
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
	//      - ご意見・不具合(settings-feedback) / レビューを書く(settings-leave-review、ネイティブのみ)
	//      - ブロック済みの料理トピック(settings-blocked-topics) / 利用規約(settings-terms)
	//      - プライバシーポリシー(settings-privacy)
	it("設定メニューの各項目が表示される", async () => {
		const tabBar = new TabBar();
		const profileScreen = new ProfileScreen();
		const settingsScreen = new SettingsScreen();

		await tabBar.gotoProfile();
		await profileScreen.gotoSettings();
		await settingsScreen.expectLoaded();

		await waitUntilVisible(settingsScreen.feedbackItem);
		await waitUntilVisible(settingsScreen.leaveReviewItem);
		await waitUntilVisible(settingsScreen.blockedTopicsItem);
		await waitUntilVisible(settingsScreen.termsItem);
		await waitUntilVisible(settingsScreen.privacyItem);
	});

	// ─ テストケース: プライバシーポリシー行で法務ドキュメント画面へ遷移する ─
	// 手順:
	//   1. 設定画面を表示する
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

	// ─ テストケース: バージョン情報が表示される(#1495 SUP-03) ─
	// 手順:
	//   1. 設定画面を表示する
	//   2. バージョン行(settings-version-section)がセマンティックバージョン形式(例: 1.14.0)で
	//      表示されることを検証する(versionText は by.text の RegExp マッチ)
	//   3. ビルド情報行(settings-build-info)の実測テキストにランタイムバージョンとビルドIDが
	//      含まれ、"undefined" を含んでいないことを検証する
	//      (取得できない場合は UNKNOWN_BUILD_META_CLIENT へフォールバックする仕様。
	//       値そのものの保証は app-expo/constants/Env.test.ts が持つので、ここでは画面に
	//       出てくる文言が「バージョンらしい形」であることだけを見る)
	//
	// ⚠️ web と異なり、ネイティブは nativeApplicationVersion 系の取得経路がある一方、
	//   VersionInfo コンポーネント自体は Env.APP_VERSION / Env.RUNTIME_VERSION / Env.COMMIT_ID を
	//   web/native 共通で読む設計（VersionInfo.tsx 参照）。ここではネイティブ実機/シミュレータ上で
	//   実際にその値が画面に描画されることを検証する。
	it("バージョン情報が表示される", async () => {
		const tabBar = new TabBar();
		const profileScreen = new ProfileScreen();
		const settingsScreen = new SettingsScreen();

		await tabBar.gotoProfile();
		await profileScreen.gotoSettings();
		await settingsScreen.expectLoaded();

		await waitUntilVisible(settingsScreen.versionSection);
		await expect(element(settingsScreen.versionText)).toBeVisible();

		const buildInfoText = await settingsScreen.getBuildInfoText();
		assert.match(buildInfoText, /^ランタイム\s+\S+・ビルド\s+\S+$/, `実測: "${buildInfoText}"`);
		assert.doesNotMatch(buildInfoText, /undefined/i, `実測: "${buildInfoText}"`);
	});
});
