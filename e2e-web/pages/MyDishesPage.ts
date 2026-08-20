import { expect, type Locator, type Page } from "@playwright/test";

/**
 * 🍽️ 「食べたい/食べた」タブの Page Object（#1396 でレビュータブから差し替え）
 *
 * 対応画面: app-expo/app/[locale]/(tabs)/my-dishes/index.tsx
 *
 * 表示内容はログイン状態で分岐する:
 * - 匿名ユーザー: ゲスト向け説明 + ログイン CTA（MyDishes.guest.*）
 * - ログイン済み: 3 ビュー（Map/リスト/Calendar）の shell + 記録 CTA（MyDishes.record.cta）
 *
 * ## PR2（#1396）時点のスコープ
 * 3 ビューの中身は shell（空のプレースホルダー）のため、ここではゲスト表示と
 * 記録 CTA（旧 `ReviewPage.postReviewButton` の後継。#1396 でクラスごと差し替え）のみを扱う。
 *
 * ## #1403 (PR1) で足したもの
 * 3 ビュー（Map / リスト / Calendar）の切替と、3 ビューが共有するフィルタの入口。
 * `index.tsx` は 1 ルート + `?view=` の切替で、**一度訪問したビューはアンマウントしない**
 * （keep-alive）。そのため「見えているビュー」の判定に `toBeVisible` を使うこと
 * （`display: none` で隠れているだけの兄弟ビューは DOM に残り続けるので、
 *   `toBeAttached` では区別が付かない）。
 */
export class MyDishesPage {
	readonly page: Page;
	/** 匿名ユーザー向けのゲスト説明文（testID: my-dishes-guest-description） */
	readonly guestDescription: Locator;
	/** 匿名ユーザー向けのログイン CTA ボタン（testID: my-dishes-guest-login-button） */
	readonly guestLoginButton: Locator;
	/** ログイン済みユーザー向けの記録 CTA（testID: my-dishes-record-button） */
	readonly recordButton: Locator;
	/** 3 ビュー共有フィルタを開くボタン（testID: my-dishes-filter-button。ログイン済みのみ表示） */
	readonly filterButton: Locator;
	/** フィルタ編集画面の本体（testID: my-dishes-filter-screen。BlurModal ではなくルート。#1396 §8-5） */
	readonly filterScreen: Locator;
	/** フィルタ編集画面の「適用する」（testID: my-dishes-filter-apply）。ここだけが store を書く */
	readonly filterApplyButton: Locator;
	/** リストビューのカード（testID: my-dishes-list-item。複数行は nth() で指す） */
	readonly listItems: Locator;
	/** Calendar の「記録がある日」セル（testID: my-dishes-calendar-day。0 件の日は別 id） */
	readonly calendarDays: Locator;

	constructor(page: Page) {
		this.page = page;
		this.guestDescription = page.getByTestId("my-dishes-guest-description");
		this.guestLoginButton = page.getByTestId("my-dishes-guest-login-button");
		this.recordButton = page.getByTestId("my-dishes-record-button");
		this.filterButton = page.getByTestId("my-dishes-filter-button");
		this.filterScreen = page.getByTestId("my-dishes-filter-screen");
		this.filterApplyButton = page.getByTestId("my-dishes-filter-apply");
		this.listItems = page.getByTestId("my-dishes-list-item");
		this.calendarDays = page.getByTestId("my-dishes-calendar-day");
	}

	/** 指定 URL へ直接遷移する（locale プレフィックス必須） */
	async goto(locale = "ja-JP"): Promise<void> {
		await this.page.goto(`/${locale}/my-dishes`);
	}

	/** 匿名ユーザー向けのゲスト表示が出ていることを検証する */
	async expectGuestViewLoaded(): Promise<void> {
		await expect(this.guestDescription).toBeVisible();
	}

	/** ログイン済みユーザー向けの記録 CTA が出ていることを検証する */
	async expectAuthenticatedViewLoaded(): Promise<void> {
		await expect(this.recordButton).toBeVisible();
	}

	// ── #1403 (PR1) 3 ビューの切替 ──────────────────────────────────

	/** ビュー切替ボタン（testID: my-dishes-view-<view>） */
	viewButton(view: MyDishesViewName): Locator {
		return this.page.getByTestId(`my-dishes-view-${view}`);
	}

	/** ビューの器（testID: my-dishes-<view>-view）。未訪問のビューはまだマウントされていない */
	view(view: MyDishesViewName): Locator {
		return this.page.getByTestId(`my-dishes-${view}-view`);
	}

	/** `?view=` を付けて直接着地する（**既定ビューは list** なので付け忘れないこと） */
	async gotoView(view: MyDishesViewName, locale = "ja-JP"): Promise<void> {
		await this.page.goto(`/${locale}/my-dishes?view=${view}`);
	}

	/** ビュー切替ボタンを押して、そのビューが見えるようになるまで待つ */
	async selectView(view: MyDishesViewName): Promise<void> {
		await this.viewButton(view).click();
		await expect(this.view(view)).toBeVisible();
	}

	/**
	 * 指定ビューだけが見えていることを検証する。
	 *
	 * keep-alive（#1396 M-1）で非表示ビューも DOM には残るため、「他が消えたこと」ではなく
	 * **「他が見えていないこと」** で判定する。
	 */
	async expectOnlyViewVisible(active: MyDishesViewName): Promise<void> {
		await expect(this.view(active)).toBeVisible();
		for (const other of MY_DISHES_VIEW_NAMES) {
			if (other === active) continue;
			await expect(this.view(other)).toBeHidden();
		}
	}

	// ── #1403 (PR1) 3 ビュー共有フィルタ ────────────────────────────

	/** フィルタの状態チップ（testID: my-dishes-filter-status-<status>） */
	filterStatusChip(status: "want" | "eaten"): Locator {
		return this.page.getByTestId(`my-dishes-filter-status-${status}`);
	}

	/** フィルタ編集画面を開く（ルートへ push されるので URL も変わる） */
	async openFilters(): Promise<void> {
		await this.filterButton.click();
		await expect(this.filterScreen).toBeVisible();
	}

	/**
	 * フィルタ編集画面で状態チップを選び、「適用する」で確定して元のビューへ戻る。
	 *
	 * ⚠️ チップ押下は **ドラフト**を書くだけで、store（= 3 ビュー共有の `queryKey`）を書くのは
	 * 「適用する」だけである（#1396 filters.tsx）。ここを分けて呼べるようにしない
	 * （押すたびに再取得が走る形をテストから作らないため）。
	 */
	async applyStatusFilter(status: "want" | "eaten"): Promise<void> {
		await this.openFilters();
		await this.filterStatusChip(status).click();
		await this.filterApplyButton.click();
		await expect(this.filterScreen).toBeHidden();
	}
}

/** 3 ビューの名前（app-expo/app/[locale]/(tabs)/my-dishes/index.tsx の `MY_DISHES_VIEWS` と対応） */
export const MY_DISHES_VIEW_NAMES = ["map", "list", "calendar"] as const;

export type MyDishesViewName = (typeof MY_DISHES_VIEW_NAMES)[number];
