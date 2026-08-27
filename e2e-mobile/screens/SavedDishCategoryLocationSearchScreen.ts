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
 * 📌 保存した料理カテゴリ（マイページ）の地点検索画面の Screen Object（#1133 / #1369）
 *
 * 対応画面: app-expo/app/[locale]/(tabs)/profile/saved-dish-category-location.tsx
 *          （中身は features/profile/containers/SavedDishCategoryLocationSearch.tsx →
 *            `features/profile/components/LocationSearchForm.tsx` を
 *            `testID="saved-dish-category-location-search"` で描画したもの）
 * 対応する e2e-web の Page Object: e2e-web/pages/ProfilePage.ts（#1133 の web 側対応）
 *
 * ## #1369 でモーダルからルートになった
 * 見えている中身は同じで、載っている «器» が BlurModal から画面へ変わった。testID は据え置きなので
 * このファイルの matcher も変わらないが、**到達判定には画面ヘッダー（`saved-dish-category-location-screen-title`）
 * を併せて見る**。入力欄だけを見ると、器が BlurModal に戻っても気付けないため。
 *
 * ## この Screen Object が必要な理由
 * #1133 以前、この地点検索は**素のテキスト入力だけ**だった。ホーム（さがすタブ）には
 * 「現在地」と「最近使った場所」があるのに、保存料理からの検索だけ毎回地名を打ち直す必要があった。
 * #1133（PR #1168）はホームと**同じ `LocationAutocomplete` / 同じ保存キー `recent_locations_v1`**を
 * 使うように揃えた。つまりこの画面の価値は「ホームと地続きであること」そのものなので、
 * 検証もホーム経由で積んだ地点がここに出るところまでを 1 本で見る必要がある。
 *
 * ## testID の由来（サフィックスは LocationAutocomplete が組み立てる）
 * `LocationSearchForm` は受け取った testID を `LocationAutocomplete` へそのまま渡し、
 * `LocationAutocomplete` が `${testID}-input` のようにサフィックスを付ける
 * （app-expo/components/LocationAutocomplete.tsx）。ホームの `search-location-autocomplete-*` と
 * 構造が同じなのは、まさに同じコンポーネントを共有しているからで、
 * **ここが崩れたら #1133 の狙い自体が崩れている**とみなしてよい。
 *
 * ## 現在地の「実取得」は検証しない
 * 現在地ボタン（`saved-dishCategory-current-location-button`）は **存在と可視までを見る**。
 * 押すと OS の位置情報許可ダイアログが出うるが、Detox には Playwright の `grantPermissions` +
 * `setGeolocation` に相当する安定した手段が無い（SearchScreen.ts の「現在地取得を移植していない」
 * 理由と同じ）。web 側の saved-dish-category-location-search.spec.ts が現在地確定まで担保するので、
 * ネイティブでは「導線が存在すること」までを分担する。
 */
export class SavedDishCategoryLocationSearchScreen {
	/** 保存した料理カテゴリのグリッド（SaveDishCategoryTab の GridList） */
	readonly grid = by.id("save-dish-category-tab-grid");

	/** 地点検索«画面»のヘッダータイトル（#1369。ScreenHeader が `${testID}-title` を付ける） */
	readonly screenTitle = by.id("saved-dish-category-location-screen-title");

	/** 地点検索の入力欄（LocationAutocomplete が `${testID}-input` を組み立てる） */
	readonly locationInput = by.id("saved-dish-category-location-search-input");
	/** 入力欄右端の「現在地を使う」ボタン（LocationSearchForm にハードコードされた testID） */
	readonly currentLocationButton = by.id("saved-dishCategory-current-location-button");
	/** 「最近使った場所」パネル（入力が空 && フォーカス中 && 履歴が 1 件以上のときだけ描画される） */
	readonly recentLocations = by.id("saved-dish-category-location-search-recent-locations");
	/** 候補（サジェスト）リスト */
	readonly suggestions = by.id("saved-dish-category-location-search-suggestions");

	/**
	 * 遷移先（マイページ配下の検索結果画面）の到達判定に使う閉じるボタン。
	 *
	 * `app/[locale]/(tabs)/profile/search-results.tsx` には testID を持つ要素が無かったため、
	 * #1133 のこの spec に合わせて閉じるボタンへ追加した。地図やリストは読み込み状態で
	 * 出たり消えたりするが、このボタンは常に描画されるので観測点として安定している。
	 */
	readonly searchResultCloseButton = by.id("profile-search-result-close-button");

	/** n 番目の保存料理カテゴリのカード（0 始まり） */
	dishCategoryCard(index: number): Detox.NativeMatcher {
		return by.id(`save-dish-category-tab-item-${index}`);
	}

	/** n 番目の「最近使った場所」（0 始まり） */
	recentLocation(index: number): Detox.NativeMatcher {
		return by.id(`saved-dish-category-location-search-recent-location-${index}`);
	}

	/** n 番目の候補（0 始まり） */
	suggestion(index: number): Detox.NativeMatcher {
		return by.id(`saved-dish-category-location-search-suggestion-${index}`);
	}

	/**
	 * 保存した料理カテゴリタブが描画されていることを検証する。
	 *
	 * #1027 と同じ理由で `toBeVisible` ではなく **`toExist`** で見る。グリッドの実体は
	 * `ListEmptyComponent` 付きの FlatList で、保存 0 件だと面積を持たず
	 * iOS の「面積の 75% 以上が可視」判定を満たせない（ProfileScreen.ts 参照）。
	 */
	async expectTabLoaded(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilExists(this.grid, timeout);
	}

	/**
	 * 保存した料理カテゴリの一覧を **実 UI で** 開く。
	 *
	 * #1402 でマイページの 4 グリッドタブが廃止され、この一覧は «独立した画面» になった。
	 * 旧実装は「保存」グループ → サブタブ「料理カテゴリ」の 2 段押し
	 * （`profile-tab-group-saved` → `profile-subtab-saved-dish-categories`）だったが、
	 * どちらの testID も存在しない。今はマイページの縦リストの行を 1 回押すだけでよい。
	 *
	 * 入口を実 UI のままにしているのは #1402 以前と同じ理由で、この spec の主題が
	 * «保存料理カテゴリからの地点検索» であってディープリンクではないため。
	 */
	async openSavedDishCategoriesTab(): Promise<void> {
		await tapWhenVisible(by.id("profile-saved-dish-categories"));
	}

	/**
	 * 先頭の保存料理カテゴリのカードを押して、地点検索画面を開く。
	 *
	 * @失敗時 保存が 0 件のときは **前提条件の不足**として日本語で名指しで落とす。
	 *   地点検索の入口はこのカードしかないため、ここで素通しにすると
	 *   「テストは緑だが地点検索を一度も開いていない」という嘘の緑になる（fail-loud の方針）。
	 *   e2e-web は `stubSavedDishCategories` で一覧 API を固定して同じ問題を回避しているが、
	 *   Detox にネットワークをスタブする手段は無いため、spec の `beforeAll` が
	 *   `utils/savedDishCategory.ts` で **前提そのものを作ってから**ここへ来る。
	 *   つまりここで落ちたら「種まきはできたのに一覧に出ていない」＝ 保存導線側の異常であり、
	 *   人手でデータを足して回避してはいけない。
	 */
	async openLocationSearchFromFirstDishCategory(): Promise<void> {
		await this.openSavedDishCategoriesTab();
		await this.expectTabLoaded();

		if (!(await existsNow(this.dishCategoryCard(0)))) {
			throw new Error(
				[
					"保存した料理カテゴリが 0 件のため、地点検索画面を開けませんでした（save-dish-category-tab-item-0 が存在しない）。",
					"  この画面の入口は保存料理カテゴリのカードだけです。",
					"  spec の beforeAll（utils/savedDishCategory.ts）が reactions へ save を 1 件入れているはずなので、",
					"  ここで 0 件なら「保存はあるのに一覧に出ない」側の異常です。",
					"  GET /v1/users/me/saved-dish-categories が dish_categories を join できているか確認してください。",
				].join("\n"),
			);
		}

		await tapWhenVisible(this.dishCategoryCard(0));
		// #1369 «画面» へ遷移したことまで見る。入力欄だけだと器が BlurModal に戻っても通ってしまう
		await waitUntilVisible(this.screenTitle);
		await waitUntilVisible(this.locationInput);
	}

	/**
	 * 「最近使った場所」パネルを表示させる。
	 *
	 * `LocationAutocomplete` の表示条件は `isFocused && 入力が空 && 履歴が 1 件以上`。
	 * 入力欄は `autofocus` 付きなので通常は開いた時点で出ているが、
	 * フォーカスが遷移アニメーションの都合で遅れる端末があるため **明示的にタップして**確定させる。
	 */
	async focusLocationInput(): Promise<void> {
		await tapWhenVisible(this.locationInput);
	}

	/**
	 * 地名を入力する（ホームの SearchScreen.typeLocation と同じ方針）。
	 *
	 * #1031 Android の Detox は Espresso の `typeTextIntoFocusedView` を使うため
	 * **ASCII 以外（= 日本語）を入力できない**。`replaceText` ならプラットフォームを問わず入る。
	 */
	async typeLocation(query: string): Promise<void> {
		await this.focusLocationInput();
		await element(this.locationInput).replaceText(query);
	}

	/** n 番目の「最近使った場所」をタップして検索を確定する */
	async selectRecentLocation(index: number): Promise<void> {
		await tapWhenVisible(this.recentLocation(index));
	}

	/**
	 * n 番目の候補（サジェスト）をタップして地点を確定する。
	 *
	 * #528 の再現操作そのもの（SearchScreen.selectLocationSuggestion と同じ役割）。
	 * ここが «押しても何も起きない» になるのが #528 の症状なので、呼び出し側は
	 * タップ後に検索結果画面への遷移まで見ること。
	 */
	async selectSuggestion(index: number): Promise<void> {
		await tapWhenVisible(this.suggestion(index));
	}

	/**
	 * マイページ配下の検索結果画面へ遷移したことを検証する。
	 *
	 * 遷移先は `/[locale]/(tabs)/profile/search-results`。到達直後は店舗データの読み込み中
	 * （RestaurantLoading が全面に被さる）なので、**中身ではなくヘッダの閉じるボタン**を待つ。
	 */
	async expectSearchResultShown(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.searchResultCloseButton, timeout);
	}
}
