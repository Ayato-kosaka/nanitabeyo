import { strict as assert } from "node:assert";

import {
	describeAuthenticated,
	launchAppWithSession,
	tapWhenVisible,
	visibleNow,
	waitUntilGone,
	waitUntilVisible,
} from "../../fixtures/e2e";
import { ProfileScreen } from "../../screens/ProfileScreen";
import { SettingsScreen } from "../../screens/SettingsScreen";
import { TabBar } from "../../screens/TabBar";

/**
 * 🗑️ アカウント削除の確認ダイアログ（#1511 ACC-01・ログイン済み）
 *
 * e2e-web の `tests/authenticated/account-delete.spec.ts` に対応する。
 *
 * ## 目的
 * **確認ダイアログに「取り消せない」と書いてあること**を守る。
 * この機能には猶予期間が無い（#1511 リーダー判断: 即時実行）。アプリ DB 側は匿名化だが
 * Supabase Auth のアカウントは物理削除するため、同じ資格情報での再ログイン経路は残らない。
 * つまり **誤操作を戻す手段は UI の文言と二段確認しかない**。文言が消えても画面は正常に
 * 見えるので、目視レビューでは落ちる種類の退行である。
 *
 * ## ⚠️ 実際の削除は実行しない（確定ボタンを押さない）
 * この spec は 2 枚目のダイアログを **キャンセル**して終わる。dev の Supabase Auth ユーザーを
 * 本当に消すと共有テストユーザー（TEST_USER_*）が失われ、`tests/authenticated/` 全体が
 * 二度と走らなくなる。Screen Object 側にも「確定まで行うヘルパー」を置いていない
 *（screens/SettingsScreen.ts の `openDeleteAccountDialog` のコメント参照）。
 *
 * ## なぜ e2e-web の 1 本では足りないのか
 * 1. **削除行は初期表示で画面外にいる。** ログアウト行のさらに下に増えたため、
 *    エミュレータの画面高では `scroll` しないと押せない（#1131 でログアウト行が
 *    同じ理由で CI を赤くしている）。この条件は Web に存在しない。
 * 2. **ダイアログが 2 枚連続する。** DialogProvider は Portal 経由でマウントされ、
 *    ネイティブでは 1 枚目が閉じるアニメーション中に 2 枚目が重なりうる。
 *    OK/キャンセルの testID は 2 枚で共通なので、タイトルの表示を待たずに押すと
 *    「1 枚目の OK をもう一度押す」ことになりかねない。この危険は Detox 側にしかない。
 *
 * ## Tier / セッション
 * Tier 2（無タグ・`tests/authenticated/`）。**共有セッションのままでよい** —
 * 確定しないので `signOut` を通らず、セッションを破壊しない
 *（`tests/authenticated/logout.test.ts` が専用セッションを発行しているのは、
 *  あちらがサーバ側でセッションを失効させるからで、こちらはその条件に当たらない）。
 */
describeAuthenticated("アカウント削除の確認（ログイン済みユーザー）", () => {
	// #1031 【バグ】beforeAll だと前のテストが残した画面状態（開いたままのダイアログ等）を次が引き継ぎ、
	// タップがオーバーレイに阻まれて落ちる。セッション注入起動は匿名クォータを消費しない
	beforeEach(async () => {
		await launchAppWithSession({ as: "authenticated" });
	});

	// ─ テストケース: 削除は二段の確認を挟み、取り消せない旨を明記する ─
	// 手順:
	//   1. マイページ → 歯車の実導線で設定画面へ遷移する
	//   2. ログアウト行の表示で「ログイン済みで決着した」ことを確かめる（＝ 注入が効いている合図）
	//   3. 削除行までスクロールしてタップし、1 枚目のダイアログを開く
	//   4. 1 枚目に「この操作は取り消せません。」が書かれていることを検証
	//   5. 「削除に進む」で 2 枚目へ進み、タイトルの表示を待ってから復元不可の明記を検証
	//   6. **キャンセル**して閉じ、設定画面に留まる（＝ 何も起きない）ことを検証
	it("削除は二段の確認を挟み、取り消せない旨を明記する", async () => {
		const tabBar = new TabBar();
		const profileScreen = new ProfileScreen();
		const settingsScreen = new SettingsScreen();

		await tabBar.gotoProfile();
		await profileScreen.gotoSettings();
		await settingsScreen.expectLoaded();

		// ログアウト行の表示 ＝ AuthProvider が「ログイン済み(非匿名)」で決着した合図。
		// ⚠️ 先にスクロールすること（#1131 と同じ理由。素の待機だと 25 秒待って落ちる）
		await settingsScreen.scrollToLogout();
		await waitUntilVisible(settingsScreen.logoutItem);

		// ── 1 枚目: 何が起きるかの説明 ──────────────────────────────
		await settingsScreen.openDeleteAccountDialog();
		// 影響範囲の説明に「取り消せない」が含まれていること。
		// ⚠️ `hasText()`（= by.text()）は **完全一致**なので、段落の一部分では絶対に一致しない。
		//    本文の text 属性を取り出して includes() する `dialogMessageIncludes()` を使う。
		//    （このテストは以前 hasText で書かれており、UI が正しくても必ず落ちていた。#1511）
		assert.equal(
			await settingsScreen.dialogMessageIncludes("この操作は取り消せません。"),
			true,
			"1 枚目の確認ダイアログに «取り消せない» の明記が無い",
		);

		// ── 2 枚目: 取り消せないことへの明示的な同意 ────────────────────
		// ⚠️ OK/キャンセルの testID は 2 枚で共通。**タイトルの入れ替わりを待ってから**押すこと
		await tapWhenVisible(settingsScreen.dialogConfirmButton);
		await waitUntilVisible(settingsScreen.deleteAccountFinalTitle);
		await waitUntilGone(settingsScreen.deleteAccountConfirmTitle);

		// ── キャンセルすると何も起きない ────────────────────────────
		// ⚠️ ここで確定ボタンを押してはいけない（ファイル冒頭の注意を参照）
		await tapWhenVisible(settingsScreen.dialogCancelButton);
		await waitUntilGone(settingsScreen.deleteAccountFinalTitle);

		// アカウント管理ページに留まり、削除行が «押せるまま» であること
		// = セッションが生きている（削除もサインアウトも走っていない）ことの確認
		//
		// ⚠️ ここは `expectLoaded()`（マイページ本体）ではない。#1629 で削除行は
		//    `profile/account` へ移っており、この時点で居るのはそちらである。
		//    取り違えると `settings-scroll` が無く 25 秒待って落ちる（run 34019438392）。
		await settingsScreen.expectAccountLoaded();
		await settingsScreen.scrollToDeleteAccount();
		assert.equal(
			await visibleNow(settingsScreen.deleteAccountItem),
			true,
			"キャンセル後もアカウント削除行は押せる状態で残っているはず",
		);
	});
});
