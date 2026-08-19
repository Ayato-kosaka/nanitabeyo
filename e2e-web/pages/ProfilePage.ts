import { expect, type Locator, type Page } from "@playwright/test";

/**
 * 👤 「マイページ」タブの Page Object
 *
 * 対応画面: app-expo/app/[locale]/(tabs)/profile/index.tsx（実体は features/profile/ProfileTabsLayout）
 *
 * タブ構成はログイン状態で分岐する:
 * - 匿名ユーザー: 保存系タブのみ（save-post / save-topic / like）+ ログインボタン表示
 * - ログイン済み: 上記に加えて reviews（投稿）・wallet（入札/収益）タブ
 */
export class ProfilePage {
	readonly page: Page;
	/** 匿名ユーザーに表示されるログインボタン */
	readonly loginButton: Locator;
	/** 保存した投稿グリッド（既存 testID） */
	readonly savedPostsGrid: Locator;
	/** 保存したトピックグリッド（既存 testID） */
	readonly savedTopicsGrid: Locator;
	/** いいねした投稿グリッド（既存 testID） */
	readonly likedGrid: Locator;
	/** 自分のレビュー投稿グリッド（ログイン済みのみ・既存 testID） */
	readonly reviewsGrid: Locator;
	/**
	 * 保存料理カテゴリから開く地点検索画面の入力欄（#1133 / #1369 でモーダルからルートへ）。
	 *
	 * testID は SavedTopicLocationSearch が LocationSearchForm へ渡す "saved-topic-location-search" が接頭辞。
	 * 内部要素の testID は LocationAutocomplete がサフィックスを付けて生成するため、
	 * ホーム（SearchPage）とまったく同じ命名規則になっている。
	 */
	readonly locationSearchInput: Locator;
	/** 地点検索画面の「最近使った場所」パネル（未入力でフォーカス中かつ1件以上のときだけ描画） */
	readonly locationSearchRecentList: Locator;
	/** 地点検索画面の「最近使った場所」全件クリアボタン */
	readonly locationSearchRecentClearButton: Locator;
	/** 地点検索画面の現在地ボタン（入力欄の右側） */
	readonly locationSearchCurrentLocationButton: Locator;
	/** 地点検索画面のサジェスト（候補）リスト */
	readonly locationSearchSuggestions: Locator;
	/** プロフィール編集ボタン（ログイン済みのみ描画。#1369 で testID を追加） */
	readonly editButton: Locator;
	/** プロフィール編集画面（ルート）のタイトル。ScreenHeader が `${testID}-title` を付ける */
	readonly editScreenTitle: Locator;

	constructor(page: Page) {
		this.page = page;
		this.loginButton = page.getByTestId("profile-login-button");
		this.savedPostsGrid = page.getByTestId("save-post-tab-grid");
		this.savedTopicsGrid = page.getByTestId("save-topic-tab-grid");
		this.likedGrid = page.getByTestId("like-tab-grid");
		this.reviewsGrid = page.getByTestId("review-tab-grid");
		this.locationSearchInput = page.getByTestId("saved-topic-location-search-input");
		this.locationSearchRecentList = page.getByTestId("saved-topic-location-search-recent-locations");
		this.locationSearchRecentClearButton = page.getByTestId("saved-topic-location-search-recent-locations-clear");
		this.locationSearchCurrentLocationButton = page.getByTestId("saved-topic-current-location-button");
		this.locationSearchSuggestions = page.getByTestId("saved-topic-location-search-suggestions");
		this.editButton = page.getByTestId("profile-edit-button");
		this.editScreenTitle = page.getByTestId("profile-edit-screen-title");
	}

	/**
	 * 「保存した料理カテゴリ」タブを開く（#1133）。
	 *
	 * タブは `?tab=` で直接指定できる（#954。ProfileTabsLayout の requestedTab）。
	 * タブヘッダには testID が無く、ラベル文言もロケール依存なのでクリックでは選ばない。
	 */
	async gotoSavedTopics(locale = "ja-JP"): Promise<void> {
		await this.page.goto(`/${locale}/profile?tab=saved-topics`);
		await expect(this.savedTopicsGrid).toBeVisible();
	}

	/** n 番目の保存料理カテゴリカードの Locator を返す（0 始まり） */
	savedTopicItem(index: number): Locator {
		return this.page.getByTestId(`save-topic-tab-item-${index}`);
	}

	/**
	 * n 番目の保存料理カテゴリを押して地点検索«画面»を開く（#1133 / #1369）。
	 *
	 * #1369 でモーダルからルートへ移したので、開いたことは **URL でも** 確認できるようになった。
	 * 「入力欄が見えている」だけだと、遷移せず同じ画面に重なっていても通ってしまうため、
	 * URL とフォーカス可能な入力欄の両方を見る（入力欄は autofocus=true）。
	 */
	async openLocationSearch(index = 0): Promise<void> {
		await this.savedTopicItem(index).click();
		await expect(this.page).toHaveURL(/\/profile\/saved-topic-location/);
		await expect(this.locationSearchInput).toBeVisible();
	}

	/** n 番目の「最近使った場所」の Locator を返す（0 始まり、先頭が最新） */
	locationSearchRecentLocation(index: number): Locator {
		return this.page.getByTestId(`saved-topic-location-search-recent-location-${index}`);
	}

	/** n 番目のサジェスト（候補）の Locator を返す（0 始まり） */
	locationSearchSuggestion(index: number): Locator {
		return this.page.getByTestId(`saved-topic-location-search-suggestion-${index}`);
	}

	/**
	 * 地点検索画面の「最近使った場所」パネルを表示する。
	 *
	 * 表示条件（入力が空 && フォーカス中 && 1件以上）はホームと同一実装なので、
	 * SearchPage.openRecentLocations と同じ手順で確定させる。
	 */
	async openLocationSearchRecentLocations(): Promise<void> {
		await this.locationSearchInput.click();
		await expect(this.locationSearchRecentList).toBeVisible();
	}

	/**
	 * プロフィール編集画面（#1369 でモーダルからルートへ）を開く。
	 *
	 * 編集ボタンはログイン済みのときだけ描画される（ゲストにはログインボタンが出る）。
	 * 到達判定は URL と ScreenHeader のタイトルの両方で行う。
	 */
	async openEdit(): Promise<void> {
		await this.editButton.click();
		await expect(this.page).toHaveURL(/\/profile\/edit/);
		await expect(this.editScreenTitle).toBeVisible();
	}

	/** 指定 URL へ直接遷移する（locale プレフィックス必須） */
	async goto(locale = "ja-JP"): Promise<void> {
		await this.page.goto(`/${locale}/profile`);
	}

	/** 匿名ユーザー向けのゲスト表示（ログインボタン）が出ていることを検証する */
	async expectGuestViewLoaded(): Promise<void> {
		await expect(this.loginButton).toBeVisible();
	}

	/** ログインボタンを押してログイン画面（/[locale]/auth/login）へ遷移する（匿名ユーザーのみ） */
	async openLogin(): Promise<void> {
		await this.loginButton.click();
	}

	/** 設定画面（歯車アイコン）へ遷移する */
	async gotoSettings(locale = "ja-JP"): Promise<void> {
		// 歯車アイコンに testID が無いため URL 直遷移で代替する
		await this.page.goto(`/${locale}/profile/settings`);
	}
}
