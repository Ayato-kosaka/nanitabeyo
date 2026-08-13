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
	 * 保存料理カテゴリから開く地点検索モーダルの入力欄（#1133）。
	 *
	 * testID は SavedTopicsTab が LocationSearchForm へ渡す "saved-topic-location-search" が接頭辞。
	 * 内部要素の testID は LocationAutocomplete がサフィックスを付けて生成するため、
	 * ホーム（SearchPage）とまったく同じ命名規則になっている。
	 */
	readonly locationModalInput: Locator;
	/** 地点検索モーダルの「最近使った場所」パネル（未入力でフォーカス中かつ1件以上のときだけ描画） */
	readonly locationModalRecentList: Locator;
	/** 地点検索モーダルの「最近使った場所」全件クリアボタン */
	readonly locationModalRecentClearButton: Locator;
	/** 地点検索モーダルの現在地ボタン（入力欄の右側） */
	readonly locationModalCurrentLocationButton: Locator;

	constructor(page: Page) {
		this.page = page;
		this.loginButton = page.getByTestId("profile-login-button");
		this.savedPostsGrid = page.getByTestId("save-post-tab-grid");
		this.savedTopicsGrid = page.getByTestId("save-topic-tab-grid");
		this.likedGrid = page.getByTestId("like-tab-grid");
		this.reviewsGrid = page.getByTestId("review-tab-grid");
		this.locationModalInput = page.getByTestId("saved-topic-location-search-input");
		this.locationModalRecentList = page.getByTestId("saved-topic-location-search-recent-locations");
		this.locationModalRecentClearButton = page.getByTestId("saved-topic-location-search-recent-locations-clear");
		this.locationModalCurrentLocationButton = page.getByTestId("saved-topic-current-location-button");
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
	 * n 番目の保存料理カテゴリを押して地点検索モーダルを開く（#1133）。
	 * 入力欄は autofocus=true なので、開いた時点でフォーカスが当たっている。
	 */
	async openLocationModal(index = 0): Promise<void> {
		await this.savedTopicItem(index).click();
		await expect(this.locationModalInput).toBeVisible();
	}

	/** n 番目の「最近使った場所」の Locator を返す（0 始まり、先頭が最新） */
	locationModalRecentLocation(index: number): Locator {
		return this.page.getByTestId(`saved-topic-location-search-recent-location-${index}`);
	}

	/**
	 * 地点検索モーダルの「最近使った場所」パネルを表示する。
	 *
	 * 表示条件（入力が空 && フォーカス中 && 1件以上）はホームと同一実装なので、
	 * SearchPage.openRecentLocations と同じ手順で確定させる。
	 */
	async openLocationModalRecentLocations(): Promise<void> {
		await this.locationModalInput.click();
		await expect(this.locationModalRecentList).toBeVisible();
	}

	/** 指定 URL へ直接遷移する（locale プレフィックス必須） */
	async goto(locale = "ja-JP"): Promise<void> {
		await this.page.goto(`/${locale}/profile`);
	}

	/** 匿名ユーザー向けのゲスト表示（ログインボタン）が出ていることを検証する */
	async expectGuestViewLoaded(): Promise<void> {
		await expect(this.loginButton).toBeVisible();
	}

	/** ログインボタンを押してログインモーダルを開く（匿名ユーザーのみ） */
	async openLoginModal(): Promise<void> {
		await this.loginButton.click();
	}

	/** 設定画面（歯車アイコン）へ遷移する */
	async gotoSettings(locale = "ja-JP"): Promise<void> {
		// 歯車アイコンに testID が無いため URL 直遷移で代替する
		await this.page.goto(`/${locale}/profile/settings`);
	}
}
