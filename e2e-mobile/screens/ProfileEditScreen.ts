import { DEFAULT_TIMEOUT, by, element, expect, tapWhenVisible, waitUntilVisible } from "../fixtures/e2e";

/**
 * ✏️ プロフィール編集画面（`/[locale]/profile/edit`）の Screen Object
 *
 * 対応コンポーネント:
 * - `app-expo/app/[locale]/(tabs)/profile/edit.tsx`（ルート本体）
 * - `app-expo/features/profile/components/ProfileEditForm.tsx`（入力欄・保存ボタンの実体）
 *
 * ## #1369 モーダルからルートへ移した
 * 以前は `ProfileTabsLayout` の中の BlurModal で、表示状態は «遷移と無関係な boolean» だった。
 * 観測点に `profile-edit-screen-title` を選んでいるのは、これが ScreenHeader
 *（`app-expo/components/ScreenHeader.tsx`）だけが出す testID で、**BlurModal 実装には
 * 存在しない**ため。フォームの中身だけを見ていると、編集 UI をオーバーレイへ戻す変更を
 * 通してしまう（LoginScreen.ts が `login-screen-title` を見るのと同じ理由）。
 * e2e-web は `toHaveURL(/\/profile\/edit/)`（pages/ProfilePage.openEdit）が同じ役目を負う。
 *
 * ## 保存は実行しない
 * 保存は `POST v1/users/me` で **共有 dev DB のテストユーザーを書き換える**（表示名・自己紹介・
 * アバター）。この画面で守りたいのは「編集 UI へ到達でき、離脱できる」ことなので、
 * 入力と保存には触れない（e2e-web 側も同じ分担）。
 */
export class ProfileEditScreen {
	/** 画面タイトル（ScreenHeader が `${testID}-title` として付ける） */
	readonly title = by.id("profile-edit-screen-title");
	/** ヘッダーの戻るボタン（`components/ScreenHeader.tsx`） */
	// #1404 ScreenHeader の戻るボタンは `${testID}-back`。共通 id だった頃は、push で背面に残る
	// 画面のヘッダーと同じ id になり «背面を押していた»
	readonly backButton = by.id("profile-edit-screen-back");

	/** 編集画面が開いていることを検証する */
	async expectOpened(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.title, timeout);
		await expect(element(this.backButton)).toBeVisible();
	}

	/** ヘッダーの戻るボタンをタップして離脱する */
	async goBack(): Promise<void> {
		await tapWhenVisible(this.backButton);
	}
}
