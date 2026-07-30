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
	/** ヘッダーの「？」ボタン（チュートリアル再表示。ja-JP のときだけ描画される） */
	readonly helpButton: Locator;
	/** 検索チュートリアル BottomSheet の内容全体 */
	readonly tutorialOverlay: Locator;
	/** チュートリアルのプライマリ CTA「つぎへ」（最終ページ以外で描画される） */
	readonly tutorialNextButton: Locator;
	/** チュートリアルのプライマリ CTA「現在地を利用する」（最終ページでだけ描画される） */
	readonly tutorialFinishButton: Locator;
	/**
	 * チュートリアルシート内に描画されている画像。
	 *
	 * ⚠️ overlay 配下に限定するのは、先読み用の 0x0 View（search/index.tsx の末尾）を
	 * 除外するため。先読み用 View は TutorialBottomSheet の兄弟要素なので、
	 * ここで拾えるのは「シートが実際に表示している画像」だけになる。
	 */
	readonly tutorialImages: Locator;

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
		this.helpButton = page.getByTestId("search-help-button");
		this.tutorialOverlay = page.getByTestId("search-tutorial-overlay");
		this.tutorialNextButton = page.getByTestId("search-tutorial-next");
		this.tutorialFinishButton = page.getByTestId("search-tutorial-finish");
		this.tutorialImages = this.tutorialOverlay.locator("img");
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

	/**
	 * ヘルプボタンからチュートリアルを手動で開き、操作できる状態になるまで待つ。
	 *
	 * ja-JP では初回訪問時に自動表示されるが、fixtures が既定で視聴済みをシードしているため、
	 * 視聴済み状態から意図的に開きたい場合はこの導線を使う。
	 */
	async openTutorial(): Promise<void> {
		await this.helpButton.click();
		await expect(this.tutorialNextButton).toBeVisible();
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
	 * 合成 click イベント（`dispatchEvent`）も使わない。react-native-web の Pressable は
	 * pointer イベントから onPress を組み立てるため、実 pointer を発火する `page.mouse` でなければ届かない。
	 *
	 * @param times 連打回数
	 */
	async submitRapid(times: number): Promise<void> {
		await this.clickRapid(this.submitButton, times);
	}

	/**
	 * チュートリアルの「つぎへ」を待機を挟まず `times` 回連打する（#1084 P3）。
	 * 連打の再現方法と理由は {@link submitRapid} と同じ。
	 *
	 * @param times 連打回数
	 */
	async tutorialNextRapid(times: number): Promise<void> {
		await this.clickRapid(this.tutorialNextButton, times);
	}

	/**
	 * 対象の中心座標へ実 pointer の down/up を `times` 回送る。
	 *
	 * 座標は最初に 1 回だけ取得する。1 発目で画面が切り替わっても同じ座標へ打ち続けることになるが、
	 * それは「連打の間にアプリが遷移してしまった」という検証したい事象そのものなので意図的にそうしている。
	 *
	 * @param locator 連打対象
	 * @param times 連打回数
	 * @失敗時 対象が描画されておらず座標を取得できない場合は日本語のメッセージで例外を投げる
	 */
	private async clickRapid(locator: Locator, times: number): Promise<void> {
		const box = await locator.boundingBox();
		if (!box) throw new Error("連打対象の座標を取得できませんでした（描画されていない可能性があります）");

		await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		for (let i = 0; i < times; i += 1) {
			await this.page.mouse.down();
			await this.page.mouse.up();
		}
	}

	/**
	 * 現在の履歴の段数を返す（#1084 P1 の主観測点）。
	 *
	 * React Navigation の push は同一 params でも常に新しいスクリーンを積むため、
	 * router.push が二重に走れば pushState も 2 回発行され段数の差分が 2 になる。
	 * リクエスト件数と違いリトライやキャッシュの影響を受けない決定論的な観測点。
	 */
	async historyLength(): Promise<number> {
		return this.page.evaluate(() => window.history.length);
	}
}
