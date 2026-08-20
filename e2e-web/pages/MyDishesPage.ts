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
 * ## #1397 (PR5/5) で足したもの
 * Map のピン → 料理メディア Sheet → 全画面 Feed（contextual filter chips 付き）の locator。
 * **ゲスト用の locator は 1 つも変えていない**（既存 spec が落ちないことが「既存で出来たことを
 * 落としていない」証跡になる。設計 (2/2) §11-3）。
 *
 * ⚠️ **Sheet の操作にホイール（`page.mouse.wheel`）を使わないこと。** TrueSheet はタッチの
 * ジェスチャで動く。spec 側で `test.use({ hasTouch: true })` を宣言し、`Locator.tap()`
 * （= `page.touchscreen` 経由の実タッチ）で操作すること。ホイールでは動かないため、
 * 「通ったように見えて何も検証していない」テストになる。
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
	// ── 3 ビュー（keep-alive。非表示側は display:none で DOM に残るため、必ず器で絞ること） ──
	/** Map ビューの器（testID: my-dishes-map-view） */
	readonly mapView: Locator;
	/** リストビューの器（testID: my-dishes-list-view） */
	readonly listView: Locator;
	/** Calendar ビューの器（testID: my-dishes-calendar-view） */
	readonly calendarView: Locator;
	/** リストビューの項目。**Map / Calendar 側の残骸を数えないよう器で絞っている** */
	readonly listItems: Locator;
	/** Calendar の「記録がある日」セル（0 件の日は `my-dishes-calendar-day-empty`） */
	readonly calendarDays: Locator;
	/** Map の店舗ピン（testID: my-dishes-map-pin） */
	readonly mapPins: Locator;

	// ── #1397 料理メディア Sheet ──────────────────────────────────
	/** Sheet 本体（testID: my-dishes-sheet） */
	readonly sheet: Locator;
	/** Sheet のヘッダ（店名タップで店舗詳細へ） */
	readonly sheetTitle: Locator;
	/** Sheet の行。動的 testID は作らない方針なので nth() で指す（§11-2） */
	readonly sheetItems: Locator;
	/** Sheet の「全画面で見る」 */
	readonly sheetExpand: Locator;

	// ── #1397 全画面 Feed ────────────────────────────────────────
	/** Feed 画面（testID: my-dishes-feed-screen） */
	readonly feedScreen: Locator;
	/** Feed の閉じるボタン */
	readonly feedCloseButton: Locator;
	/** Feed の contextual filter chips（帯）。個々の chip は `feedChips` */
	readonly feedChipsBar: Locator;
	/** chip 1 つ 1 つ。ラベルで絞るか nth() で指す（§11-2） */
	readonly feedChips: Locator;

	constructor(page: Page) {
		this.page = page;
		this.guestDescription = page.getByTestId("my-dishes-guest-description");
		this.guestLoginButton = page.getByTestId("my-dishes-guest-login-button");
		this.recordButton = page.getByTestId("my-dishes-record-button");
		this.filterButton = page.getByTestId("my-dishes-filter-button");
		this.filterScreen = page.getByTestId("my-dishes-filter-screen");
		this.filterApplyButton = page.getByTestId("my-dishes-filter-apply");

		this.mapView = page.getByTestId("my-dishes-map-view");
		this.listView = page.getByTestId("my-dishes-list-view");
		this.calendarView = page.getByTestId("my-dishes-calendar-view");
		this.listItems = this.listView.getByTestId("my-dishes-list-item");
		this.calendarDays = this.calendarView.getByTestId("my-dishes-calendar-day");
		this.mapPins = page.getByTestId("my-dishes-map-pin");

		this.sheet = page.getByTestId("my-dishes-sheet");
		this.sheetTitle = page.getByTestId("my-dishes-sheet-title");
		this.sheetItems = page.getByTestId("my-dishes-sheet-item");
		this.sheetExpand = page.getByTestId("my-dishes-sheet-expand");

		this.feedScreen = page.getByTestId("my-dishes-feed-screen");
		this.feedCloseButton = page.getByTestId("my-dishes-feed-close-button");
		this.feedChipsBar = page.getByTestId("my-dishes-feed-chips");
		this.feedChips = page.getByTestId("my-dishes-feed-chip");
	}

	/** 指定 URL へ直接遷移する（locale プレフィックス必須） */
	async goto(locale = "ja-JP"): Promise<void> {
		await this.page.goto(`/${locale}/my-dishes`);
	}

	/**
	 * ビューを指定して着地する。
	 *
	 * ⚠️ 既定ビューは **list**（`index.tsx` の `activeView`）。Map を見たいときは必ず
	 * `?view=map` を付けること。付け忘れるとピンが 1 つも出ない画面を待ち続ける。
	 */
	async gotoView(view: MyDishesViewName, locale = "ja-JP"): Promise<void> {
		await this.page.goto(`/${locale}/my-dishes?view=${view}`);
	}

	/** ヘッダのビュー切替ボタンを押す（`router.setParams` なので履歴は積まれない） */
	async selectView(view: MyDishesViewName): Promise<void> {
		await this.page.getByTestId(`my-dishes-view-${view}`).click();
		await expect(this.viewOf(view)).toBeVisible();
	}

	/** ビュー名から器の locator を引く */
	viewOf(view: MyDishesViewName): Locator {
		return view === "map" ? this.mapView : view === "list" ? this.listView : this.calendarView;
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

	// ── #1397 (PR5/5) Map のピン → Sheet → 全画面 Feed ──────────────

	/**
	 * ピンの «実際に面積を持つ» 子要素を返す。
	 *
	 * ⚠️ `testID` が付いた要素そのものは web で **幅 0** になる。Google Maps の `OverlayView`
	 * （`components/MapView.web.tsx`）が中身を「幅 0 の絶対配置 div」の中へ描くため、その中の
	 * react-native-web の `TouchableOpacity`（= `my-dishes-map-pin`）も幅 0 に潰れる。
	 * 見えている丸い吹き出しは、その 2 つ内側の «幅 48px / 高さ 52px を明示した View»
	 * （`AvatarBubbleMarker` の `container`）で、これが親からはみ出して描画されている。
	 *
	 * 面積 0 の要素は Playwright では `hidden` 扱いなので、`toBeVisible()` も `tap()` も
	 * testID の要素へは使えない。**実測した DOM の形は
	 * `[data-testid=my-dishes-map-pin] > div(translate) > div(48x52)`** なので、ここを指す。
	 * タップは子から親（`TouchableOpacity`）へ伝播するので、押下の意味は変わらない。
	 */
	pinTapTarget(index = 0): Locator {
		return this.mapPins.nth(index).locator("> div > div").first();
	}

	/**
	 * Map の先頭のピンをタップして Sheet を開く。
	 *
	 * ⚠️ `click()` ではなく `tap()`。TrueSheet はタッチのジェスチャで動くので、この画面の操作は
	 * 実タッチで通すことに統一している（spec 側で `test.use({ hasTouch: true })` が必要）。
	 */
	async tapFirstPin(): Promise<void> {
		// 面積を持つのは testID の要素ではなく中の吹き出し（`pinTapTarget` のコメント参照）
		const pin = this.pinTapTarget(0);
		await expect(pin).toBeVisible();
		await pin.tap();
	}

	/** Sheet が開いていることを検証する */
	async expectSheetOpened(): Promise<void> {
		await expect(this.sheet).toBeVisible();
		await expect(this.sheetItems.first()).toBeVisible();
	}

	/** Sheet が閉じている（＝画面に残っていない）ことを検証する。#644 の再発防止 */
	async expectSheetClosed(): Promise<void> {
		await expect(this.sheet).toBeHidden();
	}

	/** 全画面 Feed が開いていることを検証する */
	async expectFeedOpened(): Promise<void> {
		await expect(this.feedScreen).toBeVisible();
		await expect(this.page).toHaveURL(/\/my-dishes\/feed/);
	}

	/** ラベルの一部で chip を指す（動的 testID を作らない方針のため。§11-2） */
	chipWithText(text: string): Locator {
		return this.feedChips.filter({ hasText: text });
	}
}

/** 3 ビューの名前（app-expo/app/[locale]/(tabs)/my-dishes/index.tsx の `MY_DISHES_VIEWS` と対応） */
export const MY_DISHES_VIEW_NAMES = ["map", "list", "calendar"] as const;

export type MyDishesViewName = (typeof MY_DISHES_VIEW_NAMES)[number];
