import { test, expect } from "../../fixtures/test";
import { SettingsPage } from "../../pages/SettingsPage";

/**
 * ⚙️ 設定画面(匿名ユーザー)のテスト
 *
 * 目的: 設定メニューの項目構成と、匿名ユーザーへの表示制御を保証する。
 */
test.describe("設定画面(匿名ユーザー)", () => {
	// ─ テストケース: 設定メニューの各項目が表示される ─
	// 手順:
	//   1. appPage で起動し、/ja-JP/profile/settings へ遷移する
	//   2. 以下の項目が表示されることを検証:
	//      - ご意見・不具合(settings-feedback)
	//      - 利用規約(settings-terms)
	//      - プライバシーポリシー(settings-privacy)
	//      - ブロック済みの料理カテゴリ(settings-blocked-topics) ← #1132 で「トピック」から改称
	//   3. 「レビューを書く」(ストア誘導)は Web では表示されないことを検証
	test("設定メニューの各項目が表示される", async ({ appPage }) => {
		const settingsPage = new SettingsPage(appPage);
		await settingsPage.goto();
		await settingsPage.expectLoaded();

		await expect(settingsPage.feedbackItem).toBeVisible();
		await expect(settingsPage.termsItem).toBeVisible();
		await expect(settingsPage.privacyItem).toBeVisible();
		await expect(settingsPage.blockedTopicsItem).toBeVisible();
		await expect(appPage.getByText("レビューを書く", { exact: true })).toHaveCount(0);
	});

	// ─ テストケース: 匿名時はログアウトが表示されない ─
	// 手順:
	//   1. 設定画面を表示する(匿名状態)
	//   2. ログアウト行(settings-logout)が存在しないことを検証
	//      (ログアウトは非匿名ユーザーのみに表示される仕様)
	test("匿名時はログアウトが表示されない", async ({ appPage }) => {
		const settingsPage = new SettingsPage(appPage);
		await settingsPage.goto();
		await settingsPage.expectLoaded();

		await expect(settingsPage.logoutItem).toHaveCount(0);
	});

	// ─ テストケース: バージョン情報が表示される(#1495 SUP-03) ─
	// 手順:
	//   1. 設定画面を表示する
	//   2. バージョン行(settings-version-section)がセマンティックバージョン形式(例: 1.14.0)で
	//      表示されることを検証する
	//   3. ビルド情報行(settings-build-info)にランタイムバージョンとビルドIDが表示され、
	//      空文字や"undefined"を出していないことを検証する
	//      (取得できない場合は UNKNOWN_BUILD_META_CLIENT へフォールバックする仕様。
	//       constants/Env.test.ts が値そのものは保証しているので、ここでは画面に
	//       出てくる文言が「バージョンらしい形」であることだけを見る)
	test("バージョン情報が表示される", async ({ appPage }) => {
		const settingsPage = new SettingsPage(appPage);
		await settingsPage.goto();
		await settingsPage.expectLoaded();

		await expect(settingsPage.versionSection).toBeVisible();
		await expect(settingsPage.versionText).toHaveText(/^バージョン\s+\d+\.\d+\.\d+$/);

		await expect(settingsPage.buildInfoItem).toBeVisible();
		const buildInfoText = await settingsPage.buildInfoItem.innerText();
		expect(buildInfoText).toMatch(/^ランタイム\s+\S+・ビルド\s+\S+$/);
		expect(buildInfoText).not.toMatch(/undefined/i);
	});
});
