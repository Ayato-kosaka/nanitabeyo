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
 * Map のピン → 全画面 Feed（contextual filter chips 付き）の locator。
 *
 * ## #1375 実機確認で変わったこと（**ここが一番間違えやすい**）
 *
 * - **ゲストもタブの中身を見られる。** 以前はタブ全体がログイン要求で閉じていた。
 *   いまは「食べたい」＝ `reactions(save)` を匿名ユーザーでも書けるため、一覧は開いており、
 *   ログイン導線は一覧の**上に細い帯**として出る（`guestDescription` / `guestLoginButton`）。
 *   したがって «ゲストなら一覧が無い» を前提にした検証を書かないこと
 * - **記録 CTA（＋）はゲストにも出る。** 押下先は店舗選択ではなく «追加» のシート（`add-record`）
 * - **ピンタップは Sheet を開かず Feed へ push する。** 代わりに Map 下部へ
 *   **常設**のシート（`my-dishes-map-sheet`）が出る
 * - **Calendar の日セルタップは期間フィルタを書かず Feed（date スコープ）へ push する**
 * - フィルタボタンはゲストにも出る（3 ビュー切替と同じ行に並ぶ）
 */

export class MyDishesPage {
	readonly page: Page;
	/** 匿名ユーザー向けのゲスト説明文（testID: my-dishes-guest-description） */
	readonly guestDescription: Locator;
	/** 匿名ユーザー向けのログイン CTA ボタン（testID: my-dishes-guest-login-button） */
	readonly guestLoginButton: Locator;
	/**
	 * 記録 CTA（testID: my-dishes-record-button）。
	 * #1375 実機確認: **ゲストにも出る**（押下先は SNS 取り込み画面）
	 */
	readonly recordButton: Locator;
	/** 3 ビュー共有フィルタを開くボタン（testID: my-dishes-filter-button。ゲストにも出る） */
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

	// ── #1375 Map 下部の常設シート ────────────────────────────────
	/** シート本体（testID: my-dishes-map-sheet）。ピンを押さなくても出ている */
	readonly mapSheet: Locator;
	/** シートのタイル（testID: my-dishes-map-sheet-tile）。押すと Feed へ */
	readonly mapSheetTiles: Locator;

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

		this.mapSheet = page.getByTestId("my-dishes-map-sheet");
		this.mapSheetTiles = page.getByTestId("my-dishes-map-sheet-tile");

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

	/**
	 * #1375 実機確認: ゲストでも **タブの中身（一覧）が開いている**ことを検証する。
	 *
	 * 「食べたい」＝ `reactions(save)` は匿名ユーザーでも書けるので、保存はできるのに
	 * 保存したものを見られない、という状態を作らないための不変条件である。
	 */
	async expectGuestCanSeeContent(): Promise<void> {
		await expect(this.guestDescription).toBeVisible();
		await expect(this.listView).toBeVisible();
	}

	/**
	 * #1375 実機確認: 「食べた」（＝レビュー投稿）の入口を開く。
	 *
	 * ＋ の押下先は SNS URL 取り込み画面になったので、レビュー投稿は **その上部タブ**から入る。
	 * 呼び出し側が毎回 2 タップ書くと、導線がまた変わったときに全 spec を直すことになるので、
	 * ここに 1 本だけ置く。
	 */
	async openEatenRecordFlow(): Promise<void> {
		await this.recordButton.click();
		await this.page.getByTestId("sns-import-tab-eaten").click();
		// #1375（3 巡目）「食べたを記録」は別画面へ push しない統合フォームになった。
		// お店はフォーム先頭の「お店を選ぶ」から pick モードの地図で選ぶ
		await this.page.getByTestId("sns-import-eaten-form").waitFor({ state: "visible" });
	}

	/** 統合フォームの「お店を選ぶ」を押して pick モードの地図（select-restaurant）を開く */
	async openEatenRestaurantPicker(): Promise<void> {
		await this.page.getByTestId("sns-import-eaten-pick-restaurant").click();
		await this.page.getByTestId("location-autocomplete-input").waitFor({ state: "visible" });
	}

	/**
	 * #1375（6 巡目）記録フローの **1 歩目 = 料理カテゴリー**を済ませる。
	 *
	 * オーナー指示で「お店 → **料理** → 写真 → …」の順になった。カテゴリーが決まるまで
	 * 写真の選択肢もコメント欄も出ないので、店を選んだ直後は必ずここを通る。
	 *
	 * その店に既存の料理があれば一覧から選び、無ければ打った名前で新規に作る。
	 * どちらに転んでも動くよう «一覧に出たら押す / 出なければ作る» の両対応にしてある。
	 */
	async chooseDishCategoryInRecordFlow(name: string): Promise<void> {
		const step = this.page.getByTestId("review-dish-category-step");
		await step.waitFor({ state: "visible" });
		await this.page.getByTestId("review-dish-category-step-input").fill(name);

		const typedButton = this.page.getByTestId("review-dish-category-step-submit-typed");
		const firstItem = this.page.locator('[data-testid^="review-dish-category-step-item-"]').first();
		// 打った名前が候補に無ければ «この名前で決める» が出る。あれば候補が絞られて残る
		await Promise.race([
			typedButton.waitFor({ state: "visible", timeout: 15_000 }),
			firstItem.waitFor({ state: "visible", timeout: 15_000 }),
		]);
		if (await typedButton.isVisible()) {
			await typedButton.click();
		} else {
			await firstItem.click();
		}
		// 決まると写真の入口が出る（= 2 歩目へ進んだ）。コメント欄はまだ出ない
		await this.page.getByTestId("review-add-photo-placeholder").waitFor({ state: "visible", timeout: 30_000 });
	}

	/**
	 * 写真の選択を済ませてフォームへ進む（#1375 オーナー指示 7 巡目で 1 歩に分かれた）。
	 *
	 * 既定は «写真なし»。web の E2E は OS のピッカーを開けないため、
	 * 写真ありの経路は端末側（e2e-mobile）が受け持つ。
	 */
	async chooseMediaInRecordFlow(): Promise<void> {
		await this.page.getByTestId("review-skip-photo").click();
		await this.page.getByTestId("review-comment-input").waitFor({ state: "visible", timeout: 30_000 });
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

	/**
	 * #1375 実機確認: Map 下部のシートが **常設**であることを検証する。
	 * ピンを押さなくても出ている（押すと Feed へ遷移するので、押した後の検証には使わない）。
	 */
	async expectMapSheetVisible(): Promise<void> {
		await expect(this.mapSheet).toBeVisible();
		await expect(this.mapSheetTiles.first()).toBeVisible();
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
