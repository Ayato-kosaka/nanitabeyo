import {
	DEFAULT_TIMEOUT,
	by,
	element,
	existsNow,
	tapWhenVisible,
	waitUntilExists,
	waitUntilVisible,
} from "../fixtures/e2e";

/**
 * 👤 マイページの Screen Object（e2e-web の pages/ProfilePage.ts に対応）
 *
 * 対応画面: app-expo/app/[locale]/(tabs)/profile/index.tsx（実体は features/profile/ProfileTabsLayout）
 *
 * タブ構成はログイン状態で分岐する（#1031 【設計】§2）:
 * - 匿名ユーザー: 保存系タブのみ（save-post / save-topic / like）+ ログインボタン表示
 * - ログイン済み: 上記に加えて reviews（投稿）タブ ※ログイン済み前提のテストは別 PR 担当
 *
 * ゲスト時は `features/profile/containers/ProfileTabsLayout.tsx` の `!isGuest ? <Tabs.Tab name="reviews">...`
 * により reviews タブの Tabs.Tab 自体がレンダリングされない。つまり `review-tab-grid` は
 * 「非表示」ではなく「存在しない」ため、可視性ではなく存在有無で検証する。
 */
export class ProfileScreen {
	/** 匿名ユーザーに表示されるログインボタン（既存 testID） */
	readonly loginButton = by.id("profile-login-button");
	/** ログイン済みユーザーに表示される「プロフィールを編集」ボタン（#1369 で testID を追加） */
	readonly editButton = by.id("profile-edit-button");
	/**
	 * 設定画面への唯一の UI 導線（歯車ボタン）。
	 * #1031 【設計確定】B2 に関連する実装メモ: e2e-web の ProfilePage.gotoSettings() は
	 * このボタンに testID が無いため URL 直遷移（page.goto）で代替しているが、
	 * ネイティブには URL 直遷移の代替経路が無いため実 UI 導線のタップを正とする。
	 * testID（`profile-settings-button`）は PR #1033 で追加済み。
	 */
	readonly settingsButton = by.id("profile-settings-button");
	/** 保存した投稿グリッド（既存 testID） */
	readonly savedPostsGrid = by.id("save-post-tab-grid");
	/** 保存したトピックグリッド（既存 testID） */
	readonly savedTopicsGrid = by.id("save-topic-tab-grid");
	/** いいねした投稿グリッド（既存 testID） */
	readonly likedGrid = by.id("like-tab-grid");
	/** 自分のレビュー投稿グリッド（ログイン済みのみ表示。ゲスト時は Tabs.Tab ごと未マウント） */
	readonly reviewsGrid = by.id("review-tab-grid");

	/** 匿名ユーザー向けのゲスト表示（ログインボタン）が出ていることを検証する */
	async expectGuestViewLoaded(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.loginButton, timeout);
	}

	/**
	 * 保存した投稿グリッドが描画されていることを検証する。
	 *
	 * #1027 【バグ】ここは `toBeVisible` ではなく **`toExist` で見る**。
	 * グリッドの実体は `FlatList`（`ListEmptyComponent` 付き）で、保存が 0 件のテストユーザーでは
	 * 中身が空になる。iOS の `toBeVisible` は「要素の面積の 75% 以上が見えていること」を要求するため、
	 * 空リストのように面積を持たない要素は **描画されていても不可視と判定される**
	 * （run 30432596949 の iOS で save-post-tab-grid / review-tab-grid が実際にこれで落ちた）。
	 * この検証の意図は「保存タブが選択されている」ことなので、存在で判定すれば十分。
	 */
	async expectSavedPostsGridVisible(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilExists(this.savedPostsGrid, timeout);
	}

	/**
	 * ログインボタンが存在するかを **待たずに** 判定する。
	 * ログイン済みでは `!isGuest` によりボタンごとレンダリングされないため、
	 * 「ゲスト表示になっていないこと」の検証に使う（hasReviewsGrid() と対になる判定）。
	 */
	async hasLoginButton(): Promise<boolean> {
		return existsNow(this.loginButton);
	}

	/** ログインボタンをタップしてログイン画面（/[locale]/auth/login）へ遷移する（匿名ユーザーのみ） */
	async openLogin(): Promise<void> {
		await tapWhenVisible(this.loginButton);
	}

	/**
	 * 「プロフィールを編集」をタップして編集画面（/[locale]/profile/edit）へ遷移する。
	 *
	 * #1369 でモーダルからルートへ移した際に testID を付けた（それまでこのボタンには
	 * testID が無く、E2E から «押した先» を観測できなかった）。ログイン済みのときだけ
	 * 描画される（ゲストには同じ位置にログインボタンが出る）ので、匿名セッションでは押せない。
	 */
	async openEdit(): Promise<void> {
		await tapWhenVisible(this.editButton);
	}

	/** 歯車ボタンをタップして設定画面へ遷移する（#1031 確定: URL 直遷移ではなく実 UI 導線のタップ） */
	async gotoSettings(): Promise<void> {
		await tapWhenVisible(this.settingsButton);
	}

	/**
	 * レビュー投稿グリッドが存在するかを **待たずに** 判定する。
	 * ゲスト時は Tabs.Tab ごと未マウントなので、TabBar.hasNotificationsTab() と同じ考え方で使う。
	 */
	async hasReviewsGrid(): Promise<boolean> {
		return existsNow(this.reviewsGrid);
	}
}
