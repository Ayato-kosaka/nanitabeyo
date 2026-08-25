import { strict as assert } from "node:assert";

import { launchAppWithSession } from "../../fixtures/e2e";
import { ProfileScreen } from "../../screens/ProfileScreen";
import { SettingsScreen } from "../../screens/SettingsScreen";
import { TabBar } from "../../screens/TabBar";

/**
 * 🗑️ アカウント削除の導線 — 匿名ユーザー（#1511 ACC-01）
 *
 * e2e-web の `tests/profile/account-delete.spec.ts` に対応する。
 *
 * ## 目的
 * **ゲストに削除行を出さないこと**を守る。ゲスト（匿名サインイン）には `users` 行が無く、
 * API 側も `AuthUserGuard` で 403 を返す（`DELETE /v1/users/me`）。押せる導線だけ残ると、
 * 押すたびに必ずエラーになる行を設定画面に置くことになる。
 *
 * ## なぜ e2e-web の 1 本では足りないのか
 * 表示分岐は `isGuest`（`lib/authGuest.ts`）で共通だが、**この行が置かれている位置**が
 * プラットフォームで違う。ネイティブでは「レビューを書く」行が増えるぶんカードが伸び、
 * 削除行は初期表示で **画面外**にいる。Web の `toBeVisible` は要素があれば真になるが、
 * Detox は面積 75% 以上の可視を要求するため、「無い」と「見えていないだけ」の区別が
 * こちら側にしか存在しない。ここでは `existsNow`（= toExist）で **存在しない**ことを見る。
 *
 * ## Tier
 * Tier 1（無タグ）。dev DB へは一切書き込まない（削除は実行しない）。
 */
describe("アカウント削除の導線（匿名ユーザー）", () => {
	// #1031 【バグ】beforeAll だと前のテストが残した画面状態を次が引き継ぐため、テストごとに起動し直す
	beforeEach(async () => {
		await launchAppWithSession({ as: "anon" });
	});

	// ─ テストケース: 匿名時はアカウント削除行が存在しない ─
	// 手順:
	//   1. マイページ → 歯車の実導線で設定画面へ遷移する
	//   2. アカウント削除行（settings-delete-account）が存在しないことを検証
	//   3. ログアウト行も存在しないことを併せて確認する
	//      ここを見ないと「まだ auth が解決していないから出ていないだけ」と区別が付かない
	it("匿名時はアカウント削除が表示されない", async () => {
		const tabBar = new TabBar();
		const profileScreen = new ProfileScreen();
		const settingsScreen = new SettingsScreen();

		await tabBar.gotoProfile();
		await profileScreen.gotoSettings();
		await settingsScreen.expectLoaded();

		assert.equal(await settingsScreen.hasDeleteAccountItem(), false, "匿名ユーザーにアカウント削除行を出してはいけない");
		assert.equal(await settingsScreen.hasLogoutItem(), false, "匿名ユーザーにログアウト行を出してはいけない");
	});
});
