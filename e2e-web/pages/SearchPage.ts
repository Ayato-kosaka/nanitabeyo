import { expect, type Locator, type Page } from "@playwright/test";

/**
 * 🔍 「さがす」タブ（検索フォーム画面）の Page Object
 *
 * 対応画面: app-expo/app/[locale]/(tabs)/search/index.tsx
 *
 * 検索実行には必須 3 項目（場所・時間帯・シーン）の入力が必要。
 * #973 以降、検索ボタン (search-submit-button) は常にタップ可能で、
 * 未充足のまま押すと handleSearch 内のバリデーションが働き、
 * global-snackbar でエラーメッセージを表示したうえで画面遷移しない実装になっている
 * (以前は PrimaryButton の disabled で onPress 自体をガードしており、
 * このスナックバー分岐は実質到達不能だった)。
 */
export class SearchPage {
	readonly page: Page;
	/** 画面ヘッダのタイトル文字列（ja-JP: Search.headerTitle） */
	readonly headerTitle: Locator;
	/** 場所オートコンプリートの入力欄 */
	readonly locationInput: Locator;
	/** 場所入力のクリアボタン */
	readonly locationClearButton: Locator;
	/** 場所サジェストのリスト */
	readonly locationSuggestions: Locator;
	/** 検索実行ボタン（FAB） */
	readonly submitButton: Locator;
	/** 詳細条件の展開トグル */
	readonly advancedToggle: Locator;
	/** 距離スライダー */
	readonly distanceSlider: Locator;
	/** 初期表示されるおすすめ移動時間の並び */
	readonly distanceRecommendedEstimates: Locator;
	/** おすすめ外の移動時間を開閉するトグル */
	readonly distanceEstimatesToggle: Locator;
	/** グローバルスナックバー（バリデーションエラー等の通知） */
	readonly snackbar: Locator;

	constructor(page: Page) {
		this.page = page;
		this.headerTitle = page.getByText("どんな料理を探しましょう？🍽");
		// LocationAutocomplete は testID ベース + サフィックスで内部要素の testID を生成する
		this.locationInput = page.getByTestId("search-location-autocomplete-input");
		this.locationClearButton = page.getByTestId("search-location-autocomplete-clear");
		this.locationSuggestions = page.getByTestId("search-location-autocomplete-suggestions");
		this.submitButton = page.getByTestId("search-submit-button");
		this.advancedToggle = page.getByTestId("search-advanced-toggle");
		this.distanceSlider = page.getByTestId("search-distance-slider");
		this.distanceRecommendedEstimates = page.getByTestId("search-distance-recommended-estimates");
		this.distanceEstimatesToggle = page.getByTestId("search-distance-estimates-toggle");
		this.snackbar = page.getByTestId("global-snackbar");
	}

	/** 指定 URL へ直接遷移する（locale プレフィックス必須） */
	async goto(locale = "ja-JP"): Promise<void> {
		await this.page.goto(`/${locale}/search`);
	}

	/** 検索画面が表示されていることを検証する */
	async expectLoaded(): Promise<void> {
		await expect(this.headerTitle).toBeVisible();
	}

	/** 場所入力欄に文字を入力する */
	async typeLocation(query: string): Promise<void> {
		await this.locationInput.fill(query);
	}

	/** n 番目の場所サジェストの Locator を返す（0 始まり） */
	locationSuggestion(index: number): Locator {
		return this.page.getByTestId(`search-location-autocomplete-suggestion-${index}`);
	}

	/**
	 * n 番目の場所サジェストを選択し、位置情報の確定（v1/locations/details）が
	 * 完了するまで待つ。
	 *
	 * サジェスト選択(handleLocationSelect)はクリック直後に候補の文言を入力欄へ反映するが、
	 * 実際に検索の必須項目となる `location` state は非同期の詳細取得 API 完了後に
	 * セットされる。この待機なしに検索ボタンを押すと、location 未確定のまま
	 * handleSearch 内のバリデーションに引っかかり画面遷移しない。
	 */
	async selectLocationSuggestion(index: number): Promise<void> {
		const responsePromise = this.page.waitForResponse(
			(response) => response.url().includes("v1/locations/details") && response.ok(),
		);
		await this.locationSuggestion(index).click();
		await responsePromise;
	}

	/** 時間帯グリッドの項目の Locator を返す（id は timeSlots 定義の値） */
	timeSlot(id: string): Locator {
		return this.page.getByTestId(`search-time-slot-${id}`);
	}

	/** シーングリッドの項目の Locator を返す（id は sceneOptions 定義の値） */
	scene(id: string): Locator {
		return this.page.getByTestId(`search-scene-${id}`);
	}

	/** 交通手段ごとの所要時間チップを返す */
	distanceEstimate(mode: "walk" | "bike" | "car" | "train"): Locator {
		return this.page.getByTestId(`search-distance-estimate-${mode}`);
	}
}
