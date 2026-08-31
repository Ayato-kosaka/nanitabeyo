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
 * ## 保存は «押さない» が «見えていること» は見る（#1750）
 * 保存は `POST v1/users/me` で **共有 dev DB のテストユーザーを書き換える**（表示名・自己紹介・
 * アバター）ので、押さない。
 *
 * ⚠️ ただし **保存ボタンが画面の中に居ることは実端末で見ること。**
 * 「押さない」を「見ない」と読んだ結果、`KeyboardAwareForm` が器の高さを
 * `height: frame.height - 100` と当てずっぽうで決めていたせいで、**保存ボタンが
 * タブバーの裏へ押し出されて押せなくなっていた**のを誰も検出できなかった。
 * オーナー実機ログ（dev 2026-08-31 17:06 UTC）では画像を選んだあと
 * `profile_edit_screen_back_pressed` だけが記録され、保存は 1 度も起きていない。
 *
 * これは **ネイティブでしか出ない不具合**である（react-native-web はレイアウトの規則が違う）。
 * ユニットテストで固定できるのは «高さを数えていないこと» までで、
 * «実際に画面の中に居ること» はここでしか確かめられない。
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

	/**
	 * #1750 保存ボタン。押さないが «画面の中に居るか» を見る。
	 *
	 * Detox の `toBeVisible()` は既定で «画面上に 75% 以上見えているか» を見るので、
	 * タブバーの裏や画面外へ押し出された状態はここで赤くなる。
	 */
	readonly saveButton = by.id("profile-edit-save-button");

	/**
	 * #1750 保存ボタンが画面の中に見えていることを検証する。
	 *
	 * ⚠️ タップしないこと（共有 dev DB のテストユーザーを書き換えてしまう）。
	 */
	async expectSaveButtonVisible(): Promise<void> {
		await expect(element(this.saveButton)).toBeVisible();
	}

	/** ヘッダーの戻るボタンをタップして離脱する */
	async goBack(): Promise<void> {
		await tapWhenVisible(this.backButton);
	}
}
