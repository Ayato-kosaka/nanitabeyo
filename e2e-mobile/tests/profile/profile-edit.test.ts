import { describeAuthenticated, device, launchAppWithSession } from "../../fixtures/e2e";
import { ProfileEditScreen } from "../../screens/ProfileEditScreen";
import { ProfileScreen } from "../../screens/ProfileScreen";
import { TabBar } from "../../screens/TabBar";

/**
 * ✏️ プロフィール編集画面（#1369。e2e-web の tests/authenticated/profile-authenticated.spec.ts に対応）
 *
 * 目的: 編集 UI が «ルート» として開き、戻る操作で元のマイページへ帰れることを保証する。
 *
 * ## なぜ「戻れること」を実端末で見るのか
 * 編集フォームは長らく BlurModal で、表示状態は遷移と無関係な boolean だった。
 * BlurModal は自前の BackHandler（`features/blurModal/hooks/useBlurModal.tsx`）で Android の
 * 戻るキーを握るため、「戻ったつもりが閉じただけ」「閉じたつもりが戻っていた」の区別が
 * コードからは読み取りにくい。#498（Android で OAuth 成功後もモーダルが閉じない）はこの構造から
 * 出た不具合で、ログイン（#1359）と同じ乗り換えをここでも行っている。
 * ハードウェアバックがスタックの pop として効いていることは、実端末でしか確かめられない。
 *
 * ## ログイン済み前提である理由
 * 編集ボタンは `isOwnProfile && !isGuest` のときだけ描画される
 *（`features/profile/components/ProfileHeader.tsx`。ゲストには同じ位置にログインボタンが出る）。
 * `describeAuthenticated` は TEST_USER_* が無い環境で spec ごと skip する（fixtures/e2e.ts）。
 *
 * ## 保存はしない
 * 保存は共有 dev DB のテストユーザーのプロフィールを書き換えるため、入力にも保存にも触れない
 *（Screen Object のコメント参照）。ここで守るのは到達と離脱だけ。
 */
describeAuthenticated("プロフィール編集画面", () => {
	// #1031 【バグ】beforeAll だと前のテストが残した画面状態を次が引き継ぎ、タップが阻まれて落ちる。
	// セッション注入起動は匿名クォータを消費しないため、テストごとに起動し直して独立性を担保する
	beforeEach(async () => {
		await launchAppWithSession({ as: "authenticated" });
	});

	// ─ テストケース: 編集ボタンから編集画面へ遷移する ─
	// 手順:
	//   1. マイページへ遷移する（ログイン済みなので編集ボタンが出る）
	//   2. 「プロフィールを編集」をタップする
	//   3. 編集画面のヘッダー（profile-edit-screen-title）が表示されることを検証
	//      → BlurModal には存在しない testID なので、オーバーレイへ戻す変更はここで赤くなる
	it("編集ボタンを押すと編集画面が開く", async () => {
		const tabBar = new TabBar();
		const profileScreen = new ProfileScreen();
		const editScreen = new ProfileEditScreen();

		await tabBar.gotoProfile();
		await profileScreen.openEdit();

		await editScreen.expectOpened();
	});

	// ─ テストケース: 戻る操作でマイページへ帰る ─
	// ⚠️ `device.pressBack()` は Android 専用。iOS ではヘッダーの戻るボタンで同じ復帰を確認する
	//（login-screen.test.ts と同じ形）。
	// 手順:
	//   1. マイページから編集画面へ遷移する
	//   2. Android はハードウェアバック / iOS はヘッダーの戻るボタンで離脱する
	//   3. マイページ（保存した投稿グリッド）へ戻っていることを検証
	it("戻る操作でマイページへ戻る", async () => {
		const tabBar = new TabBar();
		const profileScreen = new ProfileScreen();
		const editScreen = new ProfileEditScreen();

		await tabBar.gotoProfile();
		await profileScreen.openEdit();
		await editScreen.expectOpened();

		if (device.getPlatform() === "android") {
			await device.pressBack();
		} else {
			await editScreen.goBack();
		}

		// #1402 グリッドタブが廃止されたので、戻り先の判定は縦リストの行で行う
		// （#1027 と同じ理由で存在（toExist）で見る。iOS の可視判定は面積の 75% を要求する）
		await profileScreen.expectLoaded();
	});
});
