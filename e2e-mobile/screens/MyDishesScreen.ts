import {
	DEFAULT_TIMEOUT,
	by,
	element,
	existsNow,
	tapWhenVisible,
	waitUntilGone,
	waitUntilNotVisible,
	waitUntilVisible,
} from "../fixtures/e2e";

/**
 * 🍽️ 「食べたい/食べた」タブの Screen Object（e2e-web の pages/MyDishesPage.ts に対応）
 * （#1396 でレビュータブから差し替え）
 *
 * 対応画面:
 * - `app-expo/app/[locale]/(tabs)/my-dishes/index.tsx`（タブ本体。ログイン状態で表示が分岐する）
 * - `app-expo/app/[locale]/(tabs)/my-dishes/filters.tsx`（3 ビュー共有フィルタの編集画面。#1403 で追加）
 * - `app-expo/app/[locale]/restaurant/[restaurantId]/review.tsx`
 *   （`features/map/components/ReviewForm.tsx`。レビュー投稿フォーム本体。#1396 でも中身は不変）
 *
 * 表示内容はログイン状態で分岐する（index.tsx）:
 * - 匿名ユーザー: ゲスト向け説明 + ログイン CTA（`MyDishes.guest.*`）
 * - ログイン済み: 3 ビュー（Map/リスト/Calendar）+ 共有フィルタ + 記録 CTA（`MyDishes.record.cta`）→ SelectRestaurantScreen へ
 *
 * ## このクラスがカバーする範囲
 * ゲスト向け表示と記録 CTA（旧 `postButton`）に加え、認証済み専用のレビュー投稿フォーム
 * （comment/dishCategory/price/star/submit）の定義も引き続き持つ
 * （`features/map/components/ReviewForm.tsx` 由来で #1396 では変更していない）。
 * #1403 (PR1) で **3 ビューの切替**（`selectView` / `expectOnlyViewVisible`）と
 * **3 ビュー共有フィルタ**（`applyStatusFilter` / `isFilterStatusSelected`）を足した。
 *
 * ## 写真付きレビュー投稿の扱い（#1031 B6 → #1027 で解決）
 * フォトピッカーは OS のアプリ外プロセスで動作するため Detox からは操作できない。
 * 現在は E2E ビルドに限りメディア選択を固定画像へ差し替えるフックを app-expo 側へ用意しており
 *（`app-expo/lib/e2e/selectMediaStub.ts`）、投稿フォームの操作メソッドは実際に
 * tests/mutation/review-post.test.ts から使われている。
 * **`EXPO_PUBLIC_E2E_MEDIA_HOOK=1` を立ててビルドしていないとフォームが開かない**点に注意。
 */
export class MyDishesScreen {
	/**
	 * レビュー投稿フォーム関連の待機に使うタイムアウト (ms)。
	 * 店舗レコードの作成・メディアのアップロード・レビュー登録がいずれもバックエンド往復を伴うため、
	 * 画面表示待ちの既定値（DEFAULT_TIMEOUT）では足りない。
	 */
	static readonly FORM_TIMEOUT = 90_000;

	// ── ゲスト向け表示 ──────────────────────────────────────────────────
	/** ゲスト向け説明文（testID: my-dishes-guest-description） */
	readonly guestDescription = by.id("my-dishes-guest-description");
	/** ゲスト向けログイン CTA（testID: my-dishes-guest-login-button） */
	readonly guestLoginButton = by.id("my-dishes-guest-login-button");

	// ── ログイン済み向け表示 ────────────────────────────────────────────
	/** 記録 CTA（testID: my-dishes-record-button）。タップで SelectRestaurantScreen へ遷移 */
	readonly recordButton = by.id("my-dishes-record-button");

	// ── #1397 Map のピン → 料理メディア Sheet → 全画面 Feed（定義のみ） ──────────────
	/**
	 * ⚠️ **ここから下は定義のみで、まだ spec から使っていない。**
	 *
	 * Detox には Playwright の `page.route()` に相当する «API を差し替える» 仕組みが無く、
	 * この導線はテストアカウントの実データ（どの店に何件の記録があるか）に丸ごと依存する。
	 * 実データは変動するので、Detox 側で「ピンをタップして Sheet を開く」を書くと
	 * **落ちるときに «実装が壊れた» のか «データが変わった» のか区別できない**テストになる。
	 * e2e-mobile の my-dishes がゲスト向けだけに留まっているのと同じ理由である
	 * （`tests/my-dishes/my-dishes-guest.test.ts` のスコープ）。
	 *
	 * web 側の証跡は `e2e-web/tests/authenticated/my-dishes-sheet-feed.spec.ts` が持つ。
	 * native で固定するときは、記録を作る `@mutation` 相当のセットアップとセットで書くこと。
	 */
	/** Map の店舗ピン（`MyDishesMapView.tsx`。同一店舗につき 1 つ） */
	readonly mapPin = by.id("my-dishes-map-pin");
	/** 料理メディア Sheet 本体（`MyDishesRestaurantSheet.tsx`） */
	readonly sheet = by.id("my-dishes-sheet");
	/** Sheet のヘッダ（店名タップで店舗詳細へ） */
	readonly sheetTitle = by.id("my-dishes-sheet-title");
	/** Sheet の行。動的 testID は作らないので `atIndex()` で指す（#1396 §6-1） */
	readonly sheetItem = by.id("my-dishes-sheet-item");
	/** Sheet の「全画面で見る」 */
	readonly sheetExpand = by.id("my-dishes-sheet-expand");
	/** 全画面 Feed（`app/[locale]/(tabs)/my-dishes/feed.tsx`） */
	readonly feedScreen = by.id("my-dishes-feed-screen");
	/** 全画面 Feed の閉じるボタン */
	readonly feedCloseButton = by.id("my-dishes-feed-close-button");
	/** contextual filter chips の帯（#1397 PR5） */
	readonly feedChipsBar = by.id("my-dishes-feed-chips");
	/** chip 1 つ 1 つ。`atIndex()` で指す（同上） */
	readonly feedChip = by.id("my-dishes-feed-chip");

	// ── レビュー投稿フォーム（#1031 B6: 定義のみ。`ReviewForm.tsx` 由来、認証済み専用） ──────
	/** レビュー本文入力欄（`ReviewForm.tsx:578`） */
	readonly commentInput = by.id("review-comment-input");
	/** 料理カテゴリ選択行（`ReviewForm.tsx:596`）。タップで dishCategorySearch モーダルが開く */
	readonly dishCategoryRow = by.id("review-dish-category-row");
	/** 料理カテゴリ検索モーダル本体（`ReviewForm.tsx:722`, `DishCategorySearchForm`） */
	readonly dishCategorySearch = by.id("dish-category-search");
	/** 価格入力欄（`ReviewForm.tsx:635,646`） */
	readonly priceInput = by.id("review-price-input");
	/** 投稿ボタン（`ReviewForm.tsx:706`） */
	readonly submitButton = by.id("review-submit-button");
	/**
	 * 投稿ボタン内のローディングスピナー（#1136）。
	 *
	 * `PrimaryButton` は `testID` を渡されたとき、内側の `LoadingIndicator` へ `${testID}-loading` を
	 * 派生させる（app-expo/components/PrimaryButton.tsx）。**`loading` が false の間は
	 * そもそもレンダリングされない**ため、この要素の有無がそのまま `isSubmitting` の観測点になる。
	 * e2e-web が `role="status"` で見ているものと同じ実体を指す。
	 */
	readonly submitLoadingIndicator = by.id("review-submit-button-loading");

	/**
	 * 星評価ボタン（`ReviewForm.tsx:671`）。1〜5 の整数を渡す。
	 * @param star 1〜5
	 */
	star(star: 1 | 2 | 3 | 4 | 5) {
		return by.id(`review-star-${star}`);
	}

	/** ゲスト向けログイン CTA が表示されるまで待つ */
	async expectGuestViewLoaded(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.guestLoginButton, timeout);
	}

	/** ゲスト向けログイン CTA をタップする */
	async tapGuestLogin(): Promise<void> {
		await tapWhenVisible(this.guestLoginButton);
	}

	// ── ログイン済み / レビュー投稿フォームの操作（#1031 B6 の再開後に追加） ──────────────

	/** 料理カテゴリ検索モーダルの入力欄（`ReviewForm.tsx` が testID="dish-category-search" を渡している） */
	readonly dishCategoryInput = by.id("dish-category-search-input");

	/** 料理カテゴリ検索モーダルの候補（0 始まり） */
	dishCategorySuggestion(index: number): Detox.NativeMatcher {
		return by.id(`dish-category-search-suggestion-${index}`);
	}

	/** 記録 CTA をタップして「お店選択」画面へ進む（ログイン済みのみ表示） */
	async gotoRecordDish(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.recordButton, timeout);
		await tapWhenVisible(this.recordButton);
	}

	/**
	 * レビュー投稿フォームが操作可能になるまで待つ。
	 *
	 * #1031 B6 フォームは入場直後のメディア選択が完了するまで本文入力欄を描画しない。
	 * E2E ビルドではメディア選択が固定画像へ差し替わる（app-expo の lib/e2e/selectMediaStub.ts）ため、
	 * ここで待てるのはその差し替えが効いている場合だけ。**待てない場合はフックが無効なビルド**を疑うこと。
	 */
	async expectFormLoaded(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.commentInput, timeout);
	}

	/**
	 * レビュー本文を入力する。
	 * #1031 Android の Detox は ASCII 以外を `typeText` できないため `replaceText` を使う。
	 */
	async fillComment(text: string): Promise<void> {
		await tapWhenVisible(this.commentInput);
		await element(this.commentInput).replaceText(text);
	}

	/** 料理カテゴリを検索して先頭候補を選ぶ（`isValid` に dishCategoryId が必須のため省略できない） */
	async chooseDishCategory(query: string, timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await tapWhenVisible(this.dishCategoryRow);
		await waitUntilVisible(this.dishCategoryInput, timeout);
		await element(this.dishCategoryInput).replaceText(query);
		await waitUntilVisible(this.dishCategorySuggestion(0), timeout);
		await tapWhenVisible(this.dishCategorySuggestion(0));
	}

	/** 価格を入力する（数値のみ。`isValid` は 0 より大きい有限数を要求する） */
	async fillPrice(price: string): Promise<void> {
		await element(this.priceInput).atIndex(0).replaceText(price);
	}

	/** 星評価を選ぶ */
	async rate(star: 1 | 2 | 3 | 4 | 5): Promise<void> {
		await tapWhenVisible(this.star(star));
	}

	/** 投稿ボタンをタップする */
	async submit(): Promise<void> {
		await tapWhenVisible(this.submitButton);
	}

	/**
	 * 投稿ボタンにスピナーが出ている（= `isSubmitting` が true）かを **待たずに** 判定する（#1136）。
	 * 「出るまで待つ」側は `waitUntil` と組み合わせて spec 側で行う。
	 */
	async isSubmitting(): Promise<boolean> {
		return existsNow(this.submitLoadingIndicator, 1_000);
	}

	/**
	 * 投稿ボタンが押下可能かを `getAttributes()` で読み取る（#1136）。
	 *
	 * Detox には `accessibilityState` を直接検証するマッチャが無い（utils/waits.ts の `waitUntil` 参照）。
	 * `PrimaryButton` は `disabled={isDisabled}` を `Pressable` へ渡しており、React Native は
	 * これを各プラットフォームのネイティブな「無効」状態へ落とすため、`enabled` 属性として観測できる。
	 *
	 * @returns 押下可能なら true / 無効なら false / **属性自体が取れなかった場合は null**
	 *          （プラットフォーム差で欠ける可能性があるため、呼び出し側が「観測できなかった」と
	 *          「押せてしまう」を区別できるようにする）
	 */
	async isSubmitButtonEnabled(): Promise<boolean | null> {
		// getAttributes() の戻り値は iOS / Android・単一 / 複数一致で型が分かれるため、
		// SearchScreen / ResultScreen と同じく必要なキーだけに絞ってキャストする
		const attributes = (await element(this.submitButton).getAttributes()) as { enabled?: boolean };
		return attributes.enabled ?? null;
	}

	/**
	 * 投稿が完了してフォームが閉じたことを検証する。
	 *
	 * 成功時は `showSnackbar(Map.alerts.reviewSuccess)` のあと `onCancel()` が呼ばれてフォームが閉じる
	 * （`ReviewForm.tsx` の handleSubmit）。スナックバー文言はロケール依存なので、
	 * **フォームが閉じたこと**をユーザーから観測できる成功の証跡として使う。
	 */
	async expectFormClosed(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilGone(this.submitButton, timeout);
	}

	// ── #1403 (PR1) 3 ビュー（Map / リスト / Calendar）の切替 ──────────────────
	//
	// `index.tsx` は 3 ルートに分けず **1 ルート + `?view=`** で切り替える（#1396 §2-2）。
	// さらに一度訪問したビューはアンマウントせず `display: "none"` で隠すだけである（M-1）。
	// そのため「今どのビューか」は **存在（toExist）ではなく可視（toBeVisible）** で見ること。
	// `waitUntilGone`（= not.toExist）を使うと keep-alive されたビューを検出できず、
	// 「切り替わっていないのに緑」になる。

	/** ビュー切替ボタン（testID: my-dishes-view-<view>） */
	viewButton(view: MyDishesViewName): Detox.NativeMatcher {
		return by.id(`my-dishes-view-${view}`);
	}

	/** ビューの器（testID: my-dishes-<view>-view）。未訪問のビューはまだマウントされていない */
	view(view: MyDishesViewName): Detox.NativeMatcher {
		return by.id(`my-dishes-${view}-view`);
	}

	/** ビュー切替ボタンをタップして、そのビューが見えるようになるまで待つ */
	async selectView(view: MyDishesViewName, timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await tapWhenVisible(this.viewButton(view), timeout);
		await waitUntilVisible(this.view(view), timeout);
	}

	/** 指定ビューだけが見えていることを検証する（隠れている兄弟ビューは DOM に残る前提） */
	async expectOnlyViewVisible(active: MyDishesViewName, timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.view(active), timeout);
		for (const other of MY_DISHES_VIEW_NAMES) {
			if (other === active) continue;
			await waitUntilNotVisible(this.view(other), timeout);
		}
	}

	// ── #1403 (PR1) 3 ビュー共有フィルタ ──────────────────────────────────────

	/** 3 ビュー共有フィルタを開くボタン（testID: my-dishes-filter-button。ログイン済みのみ表示） */
	readonly filterButton = by.id("my-dishes-filter-button");
	/** フィルタ編集画面の本体（testID: my-dishes-filter-screen。BlurModal ではなくルート。#1396 §8-5） */
	readonly filterScreen = by.id("my-dishes-filter-screen");
	/** フィルタ編集画面の「適用する」（testID: my-dishes-filter-apply）。ここだけが store を書く */
	readonly filterApplyButton = by.id("my-dishes-filter-apply");
	/** フィルタ編集画面の戻る（`ScreenHeader` が `${testID}-back` を派生させる） */
	readonly filterBackButton = by.id("my-dishes-filter-screen-back");

	/** フィルタの状態チップ（testID: my-dishes-filter-status-<status>） */
	filterStatusChip(status: MyDishStatusName): Detox.NativeMatcher {
		return by.id(`my-dishes-filter-status-${status}`);
	}

	/** フィルタ編集画面を開く（ルートへ push される。オーバーレイではない） */
	async openFilters(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await tapWhenVisible(this.filterButton, timeout);
		await waitUntilVisible(this.filterScreen, timeout);
	}

	/** フィルタ編集画面を「適用する」を押さずに閉じる（ドラフトは破棄される） */
	async closeFiltersWithoutApplying(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await tapWhenVisible(this.filterBackButton, timeout);
		await waitUntilGone(this.filterScreen, timeout);
	}

	/**
	 * フィルタ編集画面で状態チップを選び、「適用する」で確定して元のビューへ戻る。
	 *
	 * ⚠️ チップ押下は **ドラフト**を書くだけで、3 ビュー共有の store を書くのは
	 * 「適用する」だけである（#1396 filters.tsx）。ここを分けて呼べるようにしない
	 * （押すたびに約 964MB の `dish_reviews` へクエリが飛ぶ形をテストから作らないため）。
	 */
	async applyStatusFilter(status: MyDishStatusName, timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await this.openFilters(timeout);
		await tapWhenVisible(this.filterStatusChip(status), timeout);
		await tapWhenVisible(this.filterApplyButton, timeout);
		await waitUntilGone(this.filterScreen, timeout);
	}

	/**
	 * フィルタ編集画面を開き直して、状態チップが選択済みのままかを読む。
	 *
	 * Detox には `accessibilityState` を直接検証するマッチャが無い（utils/waits.ts の `waitUntil` 参照）ため、
	 * `getAttributes()` から `selected` を読む。`Chip`（filters.tsx）は
	 * `accessibilityState={{ selected }}` を `TouchableOpacity` へ渡しており、
	 * React Native がこれを各プラットフォームのネイティブな「選択」状態へ落とす。
	 *
	 * @returns 選択済みなら true / 未選択なら false / **属性自体が取れなかった場合は null**
	 *          （プラットフォーム差で欠ける可能性があるため、呼び出し側が「観測できなかった」と
	 *          「選択が消えた」を区別できるようにする）
	 */
	async isFilterStatusSelected(status: MyDishStatusName): Promise<boolean | null> {
		// getAttributes() の戻り値は iOS / Android・単一 / 複数一致で型が分かれるため、
		// isSubmitButtonEnabled と同じく必要なキーだけに絞ってキャストする
		const attributes = (await element(this.filterStatusChip(status)).getAttributes()) as { selected?: boolean };
		return attributes.selected ?? null;
	}
}

/** 3 ビューの名前（app-expo/app/[locale]/(tabs)/my-dishes/index.tsx の `MY_DISHES_VIEWS` と対応） */
export const MY_DISHES_VIEW_NAMES = ["map", "list", "calendar"] as const;

export type MyDishesViewName = (typeof MY_DISHES_VIEW_NAMES)[number];

/** `MyDishStatus`（shared/api/v1/dto）と対応する状態フィルタの値 */
export type MyDishStatusName = "want" | "eaten";
