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
		this.tutorialNextButton = page.getByTestId(SearchPage.TUTORIAL_NEXT_TEST_ID);
		this.tutorialFinishButton = page.getByTestId("search-tutorial-finish");
		this.tutorialImages = this.tutorialOverlay.locator("img");
	}

	/**
	 * チュートリアルのプライマリ CTA「つぎへ」の testID。
	 *
	 * ブラウザ側で `document.querySelector` に渡すためだけに定数化している
	 * （Locator からセレクタ文字列は取り出せないため。{@link pressTutorialNextIfPresent}）。
	 */
	private static readonly TUTORIAL_NEXT_TEST_ID = "search-tutorial-next";

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
	 * チュートリアルの「つぎへ」が **その瞬間に描画されていれば** 1 回だけ押す（#1086）。
	 *
	 * ⚠️ ページ送りに `tutorialNextButton.click()` を使わないこと。
	 * プライマリ CTA は **単一の DOM ノード**で、testID だけが
	 * `search-tutorial-next` ↔ `search-tutorial-finish` と入れ替わる実装になっている
	 * （TutorialBottomSheet の `isLastPage ? ... : ...`）。そのため Playwright が
	 * 「つぎへ」として解決したノードが、クリックが届く頃には「はじめよう」へ化けていることがあり、
	 * その場合は現在地取得が走って **シートが閉じてしまう**。
	 * アプリは正しいのに後続の「あとで」が見つからず落ちる偽の赤で、実測では
	 * 5 回中 3 回再現した（#1086。ページ送りアニメーション中に `onViewableItemsChanged` が
	 * `currentPage` を揺らすため窓が広い）。
	 *
	 * 要素の特定とイベント送出を **同一 JS タスク内**で行えば、この取り違えは構造的に起こり得ない。
	 *
	 * @returns 押した場合 true / 「つぎへ」が無かった（= 最終ページに居る）場合 false
	 */
	async pressTutorialNextIfPresent(): Promise<boolean> {
		return this.page.evaluate((testId: string) => {
			const element = document.querySelector(`[data-testid="${testId}"]`);
			if (!element) return false;

			const rect = element.getBoundingClientRect();
			const base = {
				bubbles: true,
				cancelable: true,
				composed: true,
				clientX: rect.left + rect.width / 2,
				clientY: rect.top + rect.height / 2,
				button: 0,
			};
			const pointer = { ...base, pointerId: 1, pointerType: "mouse", isPrimary: true };

			element.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, buttons: 1 }));
			element.dispatchEvent(new PointerEvent("pointerup", { ...pointer, buttons: 0 }));
			element.dispatchEvent(new MouseEvent("click", { ...base, buttons: 0 }));
			return true;
		}, SearchPage.TUTORIAL_NEXT_TEST_ID);
	}

	/**
	 * 対象要素へ「同一 JS タスク内で」合成 pointer イベントを `times` 回 dispatch する。
	 *
	 * ## なぜ `page.mouse.down()/up()` を使わないか（#1086 で実測して差し替え）
	 * `page.mouse` の 1 発ごとに CDP のラウンドトリップが挟まり、その隙にレンダラが
	 * React のコミット（＝ 画面遷移）を流し切ってしまう。結果 2 発目以降は
	 * **もうハンドラへ届かない**。`handleSearch` の多重検索防止ガードを外しても
	 * レコメンド API は 1 回・トピック画面も 1 枚のままで、**感度がゼロ**だった
	 * （N=2 でも N=3 でも同じ。#1086 のレビューで実測）。
	 *
	 * `locator.evaluate()` の中でループすれば全発が 1 つの JS タスクとして届く。
	 * 実測では N=2 / N=5 のいずれでも、ガードを外すと API 呼び出しと積み上がる
	 * トピック画面が N 枚になった（= 事故を再現できる）。
	 *
	 * react-native-web の Pressable は pointer イベントから onPress を組み立てるため、
	 * `click` 単発では届かない。**`pointerdown` → `pointerup` → `click` の順で**送ること。
	 *
	 * 要素参照を先に解決して同じ要素へ打ち続けるため、1 発目で画面が切り替わって
	 * 対象が DOM から外れても残りの dispatch は落ちない（「遷移してしまった」という
	 * 検証したい事象そのものを再現できる）。座標を先に取る必要も無くなったので、
	 * 「3 発目以降が遷移後の画面を叩く」制約も無い。
	 *
	 * @param locator 連打対象
	 * @param times 連打回数
	 */
	private async clickRapid(locator: Locator, times: number): Promise<void> {
		await locator.evaluate((element, count: number) => {
			const rect = element.getBoundingClientRect();
			const clientX = rect.left + rect.width / 2;
			const clientY = rect.top + rect.height / 2;
			const base = {
				bubbles: true,
				cancelable: true,
				composed: true,
				clientX,
				clientY,
				button: 0,
			};
			const pointer = { ...base, pointerId: 1, pointerType: "mouse", isPrimary: true };

			for (let i = 0; i < count; i += 1) {
				element.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, buttons: 1 }));
				element.dispatchEvent(new PointerEvent("pointerup", { ...pointer, buttons: 0 }));
				element.dispatchEvent(new MouseEvent("click", { ...base, buttons: 0 }));
			}
		}, times);
	}

	/**
	 * 現在の履歴の段数を返す。
	 *
	 * ⚠️ **これ単独では二重 push を検知できない**（#1086 で実測）。
	 * 連打でトピック画面が 5 枚積み上がっても `window.history.length` の増分は 1 のままだった。
	 * expo-router / React Navigation の web 実装は、同一タスク内で連続した push を
	 * 1 回の履歴エントリへまとめてしまうためと思われる。
	 * 二重 push の観測点は **「積み上がったトピック画面の枚数」**（TopicsPage.headerTitle の件数）で、
	 * こちらは「増えていないこと」を補助的に見るだけの位置づけ。
	 */
	async historyLength(): Promise<number> {
		return this.page.evaluate(() => window.history.length);
	}
}
