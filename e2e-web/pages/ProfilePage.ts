import { expect, type Locator, type Page } from "@playwright/test";

/**
 * 👤 「マイページ」タブの Page Object
 *
 * 対応画面: app-expo/app/[locale]/(tabs)/profile/index.tsx
 *
 * #1402 で画面の形が変わった:
 * - **4 グリッドタブ（自分のレビュー / 保存した料理 / 保存した投稿 / いいねした料理）は廃止**。
 *   `?tab=` によるタブ指定も、`review-tab-grid` / `save-post-tab-grid` も無くなった。
 * - 残る 2 つのグリッドは «独立したルート» になった
 *   （`/[locale]/profile/liked` / `/[locale]/profile/saved-dish-categories`）。
 * - **独立した設定画面も無くなり**、その項目はこの画面の縦リストに並んでいる。
 *   設定項目そのものの Locator は `pages/SettingsPage.ts` が持ち続ける（testID も据え置き）。
 *
 * ログイン状態による分岐は «ログインボタン / 編集ボタン» と «ログアウト行の有無» だけになった。
 */
export class ProfilePage {
	readonly page: Page;
	/** 匿名ユーザーに表示されるログインボタン */
	readonly loginButton: Locator;
	/** 「いいねした投稿」の行（#1402 で追加。押すと /[locale]/profile/liked へ） */
	readonly likedItem: Locator;
	/** 「保存した料理カテゴリ」の行（#1402 で追加。押すと /[locale]/profile/saved-dish-categories へ） */
	readonly savedDishCategoriesItem: Locator;
	/** 保存した料理カテゴリのグリッド（既存 testID。#1402 で単独ルートの中身になった） */
	readonly savedDishCategoriesGrid: Locator;
	/** いいねした投稿のグリッド（既存 testID。#1402 で単独ルートの中身になった） */
	readonly likedGrid: Locator;
	/**
	 * 保存料理カテゴリから開く地点検索画面の入力欄（#1133 / #1369 でモーダルからルートへ）。
	 *
	 * testID は SavedDishCategoryLocationSearch が LocationSearchForm へ渡す "saved-dish-category-location-search" が接頭辞。
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
		this.likedItem = page.getByTestId("profile-liked");
		this.savedDishCategoriesItem = page.getByTestId("profile-saved-dish-categories");
		this.savedDishCategoriesGrid = page.getByTestId("save-dish-category-tab-grid");
		this.likedGrid = page.getByTestId("like-tab-grid");
		this.locationSearchInput = page.getByTestId("saved-dish-category-location-search-input");
		this.locationSearchRecentList = page.getByTestId("saved-dish-category-location-search-recent-locations");
		this.locationSearchRecentClearButton = page.getByTestId("saved-dish-category-location-search-recent-locations-clear");
		this.locationSearchCurrentLocationButton = page.getByTestId("saved-dishCategory-current-location-button");
		this.locationSearchSuggestions = page.getByTestId("saved-dish-category-location-search-suggestions");
		this.editButton = page.getByTestId("profile-edit-button");
		this.editScreenTitle = page.getByTestId("profile-edit-screen-title");
	}

	/**
	 * 「保存した料理カテゴリ」の一覧を開く（#1133 / #1402）。
	 *
	 * #1402 でタブから «単独のルート» になったので、`?tab=` ではなく URL 直遷移で開く。
	 * 実 UI 導線（マイページの行をクリック）を通したい場合は `openSavedDishCategories()` を使うこと。
	 */
	async gotoSavedDishCategories(locale = "ja-JP"): Promise<void> {
		await this.page.goto(`/${locale}/profile/saved-dish-categories`);
		await expect(this.savedDishCategoriesGrid).toBeVisible();
	}

	/** マイページの「保存した料理カテゴリ」行をクリックして一覧へ遷移する（実 UI 導線・#1402） */
	async openSavedDishCategories(): Promise<void> {
		await this.savedDishCategoriesItem.click();
		await expect(this.page).toHaveURL(/\/profile\/saved-dish-categories/);
		await expect(this.savedDishCategoriesGrid).toBeVisible();
	}

	/** 「いいねした投稿」の一覧を開く（#1402。URL 直遷移） */
	async gotoLiked(locale = "ja-JP"): Promise<void> {
		await this.page.goto(`/${locale}/profile/liked`);
		await expect(this.likedGrid).toBeVisible();
	}

	/** マイページの「いいねした投稿」行をクリックして一覧へ遷移する（実 UI 導線・#1402） */
	async openLiked(): Promise<void> {
		await this.likedItem.click();
		await expect(this.page).toHaveURL(/\/profile\/liked/);
		await expect(this.likedGrid).toBeVisible();
	}

	/** n 番目の保存料理カテゴリカードの Locator を返す（0 始まり） */
	savedDishCategoryItem(index: number): Locator {
		return this.page.getByTestId(`save-dish-category-tab-item-${index}`);
	}

	/**
	 * n 番目の保存料理カテゴリを押して地点検索«画面»を開く（#1133 / #1369）。
	 *
	 * #1369 でモーダルからルートへ移したので、開いたことは **URL でも** 確認できるようになった。
	 * 「入力欄が見えている」だけだと、遷移せず同じ画面に重なっていても通ってしまうため、
	 * URL とフォーカス可能な入力欄の両方を見る（入力欄は autofocus=true）。
	 */
	async openLocationSearch(index = 0): Promise<void> {
		await this.savedDishCategoryItem(index).click();
		await expect(this.page).toHaveURL(/\/profile\/saved-dish-category-location/);
		await expect(this.locationSearchInput).toBeVisible();
	}

	/** n 番目の「最近使った場所」の Locator を返す（0 始まり、先頭が最新） */
	locationSearchRecentLocation(index: number): Locator {
		return this.page.getByTestId(`saved-dish-category-location-search-recent-location-${index}`);
	}

	/** n 番目のサジェスト（候補）の Locator を返す（0 始まり） */
	locationSearchSuggestion(index: number): Locator {
		return this.page.getByTestId(`saved-dish-category-location-search-suggestion-${index}`);
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

	/**
	 * マイページが表示されていることを検証する。
	 *
	 * #1402 で «設定という画面» が無くなり、設定項目はこの画面の縦リストへ移った。
	 * ロケール依存の文言ではなく、必ず出る行の testID を待つ。
	 *
	 * ⚠️ #1629 目印は «ご意見・不具合» から «なに食べよについて» へ変えた。
	 * 前者は `profile/about` へ移設されており、ここには無い（`SettingsPage.expectLoaded` と同じ）。
	 */
	async expectLoaded(): Promise<void> {
		await expect(this.page.getByTestId("settings-about")).toBeVisible();
	}
}
