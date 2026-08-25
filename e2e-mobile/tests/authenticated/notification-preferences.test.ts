import { strict as assert } from "node:assert";

import { describeAuthenticated, launchAppWithSession, waitUntilVisible } from "../../fixtures/e2e";
import { TabBar } from "../../screens/TabBar";
import { SettingsScreen } from "../../screens/SettingsScreen";
import {
	NOTIFICATION_CATEGORY_KEYS,
	NotificationSettingsSection,
} from "../../screens/NotificationSettingsSection";

/**
 * 🔔 設定画面の通知カテゴリ別オン/オフ（#1510 SET-02）
 *  （e2e-web の tests/authenticated/notification-preferences.spec.ts に対応）
 *
 * 目的: 通知カードが「ログイン済みユーザーにだけ・3 カテゴリ分・操作可能な状態で」出ることを
 *       ネイティブ側でも保証する。匿名側（カードが出ない）は tests/profile/settings.test.ts が持つ。
 *
 * ## Web 版からの差分
 * - e2e-web は `page.route()` で設定 API をスタブできるが、**Detox にはネットワーク差し替えの
 *   手段が無い**。そのため「保存失敗時のロールバック」「読み込み失敗時の再試行表示」は
 *   web 側だけの観点とし、こちらは実 API に対する表示・操作可否に絞る。
 * - e2e-web は URL 直遷移するが、ネイティブには代替経路が無いのでマイページの歯車を実際に押す。
 *
 * ## ⚠️ この spec は migration 適用後でないと通らない
 * 通知カードは `GET /v1/users/me/notification-preferences` の結果を描画する。この API は
 * `user_notification_preferences` テーブルを引くため、**migration
 * （infra/supabase/migrations/20260823T0100_create_user_notification_preferences.sql）が
 * dev へ適用されるまでは 500 になり、トグルではなく再試行行が出る。**
 * migration はオーナー承認待ちで未適用（PR 本文の「DB マイグレーションを含みます（未適用）」参照）。
 * 適用後にこの spec を実行すること。
 *
 * ## 書き込みを伴う（Tier 3 相当）
 * トグルの操作は共有 dev アカウントの受信設定を実際に書き換える。テストの最後に
 * **必ず元の状態へ戻す**ことでテスト間の干渉を避ける。戻す操作自体も 1 回の PATCH なので、
 * 「オンへ戻せる（オフは可逆）」の検証を兼ねている。
 */
describeAuthenticated("設定 > 通知カテゴリ別オン/オフ（ログイン済み）", () => {
	// #1031 【バグ】beforeAll だと前のテストが残した画面状態（開いたままのモーダル等）を次が引き継ぎ、
	// タップがオーバーレイに阻まれて落ちる。セッション注入起動は匿名クォータを消費しないため、
	// テストごとに起動し直して独立性を担保する
	beforeEach(async () => {
		await launchAppWithSession({ as: "authenticated" });
	});

	/**
	 * マイページ（= 設定画面）まで進めて通知カードを返す。
	 *
	 * ⚠️ `ProfileScreen.gotoSettings()` は使えない。#1402 で **歯車の 1 階層が無くなり**、
	 *    マイページタブがそのまま設定画面になっている。main 由来の #1510 のテストは
	 *    歯車があった頃の形で書かれており、このブランチへ合流したときに
	 *    存在しないメソッドの呼び出しとして残っていた
	 */
	const openNotificationSection = async (): Promise<NotificationSettingsSection> => {
		const tabBar = new TabBar();
		const settingsScreen = new SettingsScreen();
		const section = new NotificationSettingsSection();

		await tabBar.gotoProfile();
		await settingsScreen.expectLoaded();
		await section.expectVisible();

		return section;
	};

	// ─ テストケース: 3 カテゴリのトグルが表示される ─
	// 手順:
	//   1. マイページ→歯車の実導線で設定画面へ遷移する
	//   2. 通知カード(settings-notifications-card)が表示されることを検証
	//   3. likes / saves / group_votes の行と Switch が表示されることを検証
	//   4. 読み込み失敗の再試行行が **出ていない** ことを検証
	//      （出ていたら API が失敗している = migration 未適用の可能性が高い）
	it("3 カテゴリのトグルが表示される", async () => {
		const section = await openNotificationSection();

		const hasErrorRow = await section.hasErrorRow();
		assert.equal(
			hasErrorRow,
			false,
			"通知設定の取得に失敗している（migration 未適用か API 障害）。再試行行が出ている",
		);

		for (const category of NOTIFICATION_CATEGORY_KEYS) {
			await waitUntilVisible(section.row(category));
			await waitUntilVisible(section.switchOf(category));
		}
	});

	// ─ テストケース: トグルを切り替えると状態が変わり、元へ戻せる ─
	// 手順:
	//   1. 設定画面の通知カードを開く
	//   2. 「保存」(saves) 行の状態シグネチャを控える
	//   3. 行をタップし、状態が変化するまで待つ
	//   4. もう一度タップし、状態が元へ戻るまで待つ（= dev アカウントの後片付けを兼ねる）
	//
    // saves を選んでいるのは、内部種別が 1 つ（dish_media:save）しか無く、
    // 他カテゴリと取り違えても気付きやすいため。
	//
	// ⚠️ ここでは「プッシュが実際に止まること」は検証できない（実機に配信させるテストは
	// 共有環境に対して副作用が大きすぎる）。それは API 側の
	// api/src/internal/notifications/notification-job.preferences.spec.ts が固定している
	it("トグルを切り替えると状態が変わり、元へ戻せる", async () => {
		const section = await openNotificationSection();

		const initial = await section.readStateSignature("saves");

		await section.toggle("saves");
		const afterToggle = await section.waitForStateChange("saves", initial);
		assert.notEqual(afterToggle, initial, "タップしてもトグルの状態が変わらなかった");

		// 後片付け兼「オフは可逆」の検証。ここを省くと共有 dev アカウントが
		// オフのまま残り、次に走った他の spec や手動確認を惑わせる
		await section.toggle("saves");
		const restored = await section.waitForStateChange("saves", afterToggle);
		assert.equal(restored, initial, "トグルを元の状態へ戻せなかった");
	});

	// ─ テストケース: OS 通知が拒否されていてもトグルは操作可能なまま ─
	// 手順:
	//   1. 設定画面の通知カードを開く
	//   2. OS 拒否の案内行(settings-notifications-os-denied)が出ているかを確認する
	//   3. 案内行の有無にかかわらず、トグル行が表示され操作できることを検証
	//
	// #1510 リーダー判断 §4: OS 側が拒否でもトグルは無効化しない。設定はアカウント単位で
	// 他の端末（許可済みの端末）には効くため、この端末の OS 状態で無効化するのは正しくない。
	// e2e の起動オプションは通知を許可するので通常は案内行が出ないが、
	// **出ていてもトグルが死んでいないこと**がこのテストの主眼
	it("OS 通知の許可状態にかかわらずトグルは操作できる", async () => {
		const section = await openNotificationSection();

		const hasOsDeniedNotice = await section.hasOsDeniedNotice();

		// 案内が出ていてもいなくても、トグルは触れる状態でなければならない
		await waitUntilVisible(section.row("likes"));
		const initial = await section.readStateSignature("likes");
		await section.toggle("likes");
		const afterToggle = await section.waitForStateChange("likes", initial);
		assert.notEqual(
			afterToggle,
			initial,
			`トグルが操作できなかった（OS 拒否の案内行: ${hasOsDeniedNotice}）`,
		);

		// 後片付け
		await section.toggle("likes");
		await section.waitForStateChange("likes", afterToggle);
	});
});
