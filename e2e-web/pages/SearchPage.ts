import { expect, type Locator, type Page } from "@playwright/test";
import { clickRapid } from "../utils/rapid-click";

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
	/** #1502 地点確認中(details 取得中)の表示 */
	readonly locationConfirming: Locator;
	/** #1502 地点確定済みの表示 */
	readonly locationConfirmed: Locator;
	/** #1502 地点確認失敗の表示 */
	readonly locationConfirmationError: Locator;
	/** #1502 地点確認失敗時の再試行ボタン */
	readonly locationConfirmationRetry: Locator;
	/** 「最近使った場所」のリスト（#953）。未入力でフォーカスしたときだけ描画される */
	readonly recentLocationsList: Locator;
	/** 「最近使った場所」を全件クリアするボタン（1件以上あるときだけ描画される） */
	readonly recentLocationsClearButton: Locator;
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
	/** ヘッダーの「？」ボタン（オンボーディング再表示。ja-JP のときだけ描画される） */
	readonly helpButton: Locator;

	constructor(page: Page) {
		this.page = page;
		this.headerTitle = page.getByText("どんな料理を探しましょう？🍽");
		// LocationAutocomplete は testID ベース + サフィックスで内部要素の testID を生成する
		this.locationInput = page.getByTestId("search-location-autocomplete-input");
		this.locationClearButton = page.getByTestId("search-location-autocomplete-clear");
		this.locationSuggestions = page.getByTestId("search-location-autocomplete-suggestions");
		this.locationConfirming = page.getByTestId("search-location-autocomplete-confirmation-confirming");
		this.locationConfirmed = page.getByTestId("search-location-autocomplete-confirmation-confirmed");
		this.locationConfirmationError = page.getByTestId("search-location-autocomplete-confirmation-error");
		this.locationConfirmationRetry = page.getByTestId("search-location-autocomplete-confirmation-retry");
		this.recentLocationsList = page.getByTestId("search-location-autocomplete-recent-locations");
		this.recentLocationsClearButton = page.getByTestId("search-location-autocomplete-recent-locations-clear");
		this.submitButton = page.getByTestId("search-submit-button");
		this.advancedToggle = page.getByTestId("search-advanced-toggle");
		this.distanceSlider = page.getByTestId("search-distance-slider");
		this.distanceRecommendedEstimates = page.getByTestId("search-distance-recommended-estimates");
		this.distanceEstimatesToggle = page.getByTestId("search-distance-estimates-toggle");
		this.snackbar = page.getByTestId("global-snackbar");
		this.helpButton = page.getByTestId("search-help-button");
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

	/** n 番目の「最近使った場所」の Locator を返す（0 始まり、先頭が最新） */
	recentLocation(index: number): Locator {
		return this.page.getByTestId(`search-location-autocomplete-recent-location-${index}`);
	}

	/**
	 * 「最近使った場所」パネルを表示する。
	 *
	 * `LocationAutocomplete` は「入力が空 && フォーカス中」のときだけこのパネルを出す
	 * （showRecentLocations の条件）。クリアボタンは押下後に自身で入力欄へフォーカスを戻すが
	 * （handleClear の `inputRef.current?.focus()`）、それだけに頼らず明示的に入力欄をクリックして
	 * フォーカスを確定させる。
	 */
	async openRecentLocations(): Promise<void> {
		if (await this.locationClearButton.isVisible().catch(() => false)) {
			await this.locationClearButton.click();
		}
		await this.locationInput.click();
		await expect(this.recentLocationsList).toBeVisible();
	}

	/** 時間帯グリッドの項目の Locator を返す（id は timeSlots 定義の値） */
	timeSlot(id: string): Locator {
		return this.page.getByTestId(`search-time-slot-${id}`);
	}

	/** シーングリッドの項目の Locator を返す（id は sceneOptions 定義の値） */
	scene(id: string): Locator {
		return this.page.getByTestId(`search-scene-${id}`);
	}

	/** 食べたい系統チップの Locator を返す（id は tasteOptions / coreIngredientOptions 定義の値） */
	foodStyle(featureType: "taste" | "core_ingredient", id: string): Locator {
		return this.page.getByTestId(`search-food-style-${featureType}-${id}`);
	}

	/** 交通手段ごとの所要時間チップを返す */
	distanceEstimate(mode: "walk" | "bike" | "car" | "train"): Locator {
		return this.page.getByTestId(`search-distance-estimate-${mode}`);
	}

	/**
	 * ヘルプボタンからオンボーディングを手動で開く（#1486 §3）。
	 *
	 * ja-JP では初回訪問時に自動で開くが、fixtures が既定で既読をシードしているため、
	 * 既読状態から意図的に開きたい場合はこの導線を使う。
	 *
	 * ⚠️ 開いた «後» の検証は {@link OnboardingPage} が持つ。ここは押すだけにしてある
	 * （オンボーディングは検索画面の中のシートではなく、独立したルートになった）。
	 */
	async openOnboarding(): Promise<void> {
		await this.helpButton.click();
	}

	/**
	 * 検索ボタンを待機を挟まず `times` 回連打する（#1084 P1/P2）。
	 *
	 * ⚠️ `locator.click()` のループにはしないこと。
	 * - `click()` は毎回 actionability チェック（可視・安定・enabled・hit-target）を通るため、
	 *   タップの間に必ず待機が挟まり「連打」の再現にならない
	 * - 1 発目で router.push が走ると検索画面が unmount され、2 発目の `click()` は
	 *   "element is not attached to the DOM" で落ちる（連打事故の有無と無関係に赤くなる）
	 *
	 * @param times 連打回数
	 */
	async submitRapid(times: number): Promise<void> {
		await clickRapid(this.submitButton, times);
	}

	/**
	 * 現在の履歴の段数を返す。
	 *
	 * ⚠️ **これ単独では二重 push を検知できない**（#1086 で実測）。
	 * 連打でトピック画面が 5 枚積み上がっても `window.history.length` の増分は 1 のままだった。
	 * expo-router / React Navigation の web 実装は、同一タスク内で連続した push を
	 * 1 回の履歴エントリへまとめてしまうためと思われる。
	 * 二重 push の観測点は **「積み上がったトピック画面の枚数」**（DishCategoriesPage.headerTitle の件数）で、
	 * こちらは「増えていないこと」を補助的に見るだけの位置づけ。
	 */
	async historyLength(): Promise<number> {
		return this.page.evaluate(() => window.history.length);
	}
}
