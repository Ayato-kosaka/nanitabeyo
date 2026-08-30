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
 * 対応画面: app-expo/app/[locale]/(tabs)/profile/index.tsx
 *
 * #1402 で画面の形が変わった:
 * - **4 グリッドタブは廃止**。`review-tab-grid` / `save-post-tab-grid` と
 *   サブタブ（`profile-subtab-*`）は存在しない。
 * - 残る 2 つのグリッドは «独立した画面» になった（`profile-liked` / `profile-saved-dish-categories` の行から遷移）。
 * - **独立した設定画面も無くなり**、その項目はこの画面の縦リストにある。
 *   歯車ボタン（`profile-settings-button`）も一緒に消えた。設定項目の Locator は
 *   `screens/SettingsScreen.ts` が持ち続ける（testID も据え置き）。
 *
 * ログイン状態による分岐は «ログインボタン / 編集ボタン» と «ログアウト行の有無» だけになった。
 */
export class ProfileScreen {
	/** 匿名ユーザーに表示されるログインボタン（既存 testID） */
	readonly loginButton = by.id("profile-login-button");
	/** ログイン済みユーザーに表示される「プロフィールを編集」ボタン（#1369 で testID を追加） */
	readonly editButton = by.id("profile-edit-button");
	/** 「いいねした投稿」の行（#1402。押すと /[locale]/profile/liked へ遷移する） */
	readonly likedItem = by.id("profile-liked");
	/** 「保存した料理カテゴリ」の行（#1402。押すと /[locale]/profile/saved-dish-categories へ遷移する） */
	readonly savedDishCategoriesItem = by.id("profile-saved-dish-categories");
	/** 保存した料理カテゴリのグリッド（既存 testID。#1402 で単独画面の中身になった） */
	readonly savedDishCategoriesGrid = by.id("save-dish-category-tab-grid");
	/** いいねした投稿のグリッド（既存 testID。#1402 で単独画面の中身になった） */
	readonly likedGrid = by.id("like-tab-grid");

	/** 匿名ユーザー向けのゲスト表示（ログインボタン）が出ていることを検証する */
	async expectGuestViewLoaded(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.loginButton, timeout);
	}

	/**
	 * マイページが描画されていることを検証する（#1402）。
	 *
	 * 旧実装は「保存した投稿グリッドが出ていること」で «マイページに着いた» を見ていたが、
	 * そのグリッドはタブごと廃止された。代わりに縦リストの先頭付近にある
	 * 「いいねした投稿」の行を見る（ゲスト・ログイン済みのどちらでも必ず描かれる）。
	 *
	 * #1027 【バグ】ここは `toBeVisible` ではなく **`toExist` で見る**流儀を踏襲する。
	 * iOS の `toBeVisible` は「要素の面積の 75% 以上が見えていること」を要求するため、
	 * スクロール位置や端末サイズによっては «描画されていても不可視» と判定されうる
	 * （run 30432596949 の iOS で save-post-tab-grid / review-tab-grid が実際にこれで落ちた）。
	 */
	async expectLoaded(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilExists(this.likedItem, timeout);
	}

	/**
	 * 設定項目のある画面へ進む。
	 *
	 * ⚠️ **もう «歯車 → 設定画面» は無い。** #1402 でその 1 階層を無くし、設定項目は
	 * マイページ本体（`app/[locale]/(tabs)/profile/index.tsx`）の縦リストへ統合した。
	 * `testID`（`settings-*`）は据え置きなので、**マイページを開いた時点で既に «設定画面» に居る**。
	 *
	 * それでもこのメソッドを残すのは、main 側で書かれた spec（#1510 通知設定 / #1511 退会）が
	 * «マイページ → 設定» の 2 段で書かれているためである。ここを «何もしない» にしておけば
	 * 両方の書き方がそのまま通り、合流のたびに spec を書き換えずに済む。
	 */
	async gotoSettings(): Promise<void> {
		// 遷移は不要。マイページがそのまま設定画面である（上の JSDoc 参照）
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

	/** 「いいねした投稿」の行をタップして一覧画面（/[locale]/profile/liked）へ遷移する（#1402） */
	async openLiked(): Promise<void> {
		await tapWhenVisible(this.likedItem);
	}

	/** 「保存した料理カテゴリ」の行をタップして一覧画面（/[locale]/profile/saved-dish-categories）へ遷移する（#1402） */
	async openSavedDishCategories(): Promise<void> {
		await tapWhenVisible(this.savedDishCategoriesItem);
	}

	/**
	 * 廃止された 4 グリッドタブの痕跡が残っていないかを **待たずに** 判定する（#1402）。
	 * `review-tab-grid` / `save-post-tab-grid` はタブごと無くなったので、
	 * どちらかが存在したらこの Issue の変更が巻き戻っている。
	 */
	async hasLegacyGridTabs(): Promise<boolean> {
		// ⚠️ `existsNow(a) || existsNow(b)` と書かないこと。existsNow は Promise を返すので
		// 左辺が常に truthy になり、**何があっても true を返す**（＝検査にならない）
		if (await existsNow(by.id("review-tab-grid"))) return true;
		return existsNow(by.id("save-post-tab-grid"));
	}
}
