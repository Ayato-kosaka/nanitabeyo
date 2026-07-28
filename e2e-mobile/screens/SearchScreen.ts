import {
	DEFAULT_TIMEOUT,
	by,
	element,
	existsNow,
	expect,
	waitFor,
	waitUntilGone,
	waitUntilVisible,
} from "../fixtures/e2e";

/**
 * 🔍 「さがす」タブ（検索フォーム画面）の Screen Object
 *
 * 対応画面: app-expo/app/[locale]/(tabs)/search/index.tsx
 * 対応する e2e-web の Page Object: e2e-web/pages/SearchPage.ts
 *
 * ## 検索の必須項目
 * 検索実行には 場所 / 時間帯 / 同行者（シーン）の 3 つが必要。
 * 時間帯（既定 `lunch`）と同行者（既定 `solo`）には初期値があるため、**未確定なのは場所だけ**になる。
 * #973 以降、検索ボタン (`search-submit-button`) は常にタップ可能で、未充足のまま押すと
 * `handleSearch` 内のバリデーションが `global-snackbar` を出したうえで遷移をガードする。
 *
 * ## Detox と Playwright の違い（#1031 §2）
 * `element()` はグローバル API なので、e2e-web の Page Object と違いコンストラクタ引数を取らない。
 * TabBar.ts と同じく **by.id をそのまま readonly フィールドに持ち、操作メソッドで element() に包む**。
 *
 * ## 移植を落とした検証（#1031 確定判断 / testID ギャップ）
 * - **B1**: `accessibilityRole="radiogroup"` / `accessibilityState.selected` 等の a11y 属性検証は
 *   Detox に対応 API が無いため対象外。時間帯・同行者の「選択状態」は Web 側の a11y テストで担保する。
 *   ネイティブでは「タップできること」と「その結果として検索が成立すること」までを検証範囲とする
 * - **B3**: 距離に応じたおすすめ移動時間は **順序検証を落とし、表示有無のみ**を検証する
 *   （Detox には子孫の前方一致セレクタも要素数アサーション（toHaveCount 相当）も無いため）
 * - **距離スライダーの値変更**（e2e-web の distance-slider.spec.ts）は移植していない。
 *   `search-distance-slider` は PanResponder ベースの自作スライダーで、現在値は `aria-valuenow`
 *   （= web 専用属性）にしか出ておらず、**値を反映する testID が app-expo に無い**ため
 *   Detox からは操作後の値を検証できない。値検証用の testID が追加されたら移植すること
 * - **現在地取得**（e2e-web の current-location.spec.ts）は移植していない。
 *   「拒否」「タイムアウト」の再現には起動時の権限設定を spec ごとに切り替える必要があるが、
 *   fixtures/e2e.ts の `platformLaunchOptions()` は権限を常に付与する固定実装のため、
 *   拒否ケースを表現できない。fixtures 側に権限を切り替える起動オプションが入ったら移植すること
 */
export class SearchScreen {
	/** 画面ヘッダのタイトル（i18n: Search.headerTitle） */
	readonly headerTitle = by.id("search-header-title");
	/** ヘッダーの「？」ボタン（チュートリアル再表示。ja-JP のときのみ表示される） */
	readonly helpButton = by.id("search-help-button");

	/** 場所オートコンプリートの入力欄 */
	readonly locationInput = by.id("search-location-autocomplete-input");
	/** 場所入力のクリアボタン（入力が 1 文字以上あるときだけ描画される） */
	readonly locationClearButton = by.id("search-location-autocomplete-clear");
	/** 場所サジェストのリスト */
	readonly locationSuggestions = by.id("search-location-autocomplete-suggestions");
	/** 入力欄右端の「現在地を使う」ボタン */
	readonly currentLocationButton = by.id("search-current-location-button");

	/** 詳細条件の展開トグル */
	readonly advancedToggle = by.id("search-advanced-toggle");
	/** 距離スライダー */
	readonly distanceSlider = by.id("search-distance-slider");
	/** おすすめの移動時間チップの並び（#1031 B3: 表示有無のみ検証する） */
	readonly distanceRecommendedEstimates = by.id("search-distance-recommended-estimates");
	/** おすすめ外の移動時間を開閉するトグル */
	readonly distanceEstimatesToggle = by.id("search-distance-estimates-toggle");
	/** おすすめ外の移動時間チップの並び（トグルを開いたときだけ描画される） */
	readonly distanceOtherEstimates = by.id("search-distance-other-estimates");

	/** 検索実行ボタン（画面下部固定の FAB） */
	readonly submitButton = by.id("search-submit-button");
	/** グローバルスナックバー（バリデーションエラー等の通知） */
	readonly snackbar = by.id("global-snackbar");

	/** 検索チュートリアル（BottomSheet）のコンテンツ全体 */
	readonly tutorialOverlay = by.id("search-tutorial-overlay");
	/** チュートリアルの「つぎへ」（最終ページ以外で描画される） */
	readonly tutorialNextButton = by.id("search-tutorial-next");
	/** チュートリアルの「はじめよう」（最終ページのプライマリ CTA。押すと現在地取得が走る） */
	readonly tutorialFinishButton = by.id("search-tutorial-finish");
	/** チュートリアルの「あとで」（最終ページのセカンダリ CTA。現在地取得を伴わずに完了する） */
	readonly tutorialLaterButton = by.id("search-tutorial-later");

	/**
	 * スクロール操作の起点にする要素。
	 *
	 * #1031 【設計】検索画面の `ScrollView` には testID が無いため、Detox の
	 * `whileElement(...).scroll()` が使えない。代わりに **スクロール領域の内側にある実在の要素**を
	 * 掴んで swipe することで同等のスクロールを行う（`search-scene-solo` は同行者グリッドの先頭項目）。
	 * ⚠️ app-expo に `search-scroll-view` 相当の testID が追加されたら `whileElement().scroll()` へ置き換えること。
	 */
	private readonly scrollAnchor = by.id("search-scene-solo");

	/** n 番目の場所サジェスト（0 始まり） */
	locationSuggestion(index: number): Detox.NativeMatcher {
		return by.id(`search-location-autocomplete-suggestion-${index}`);
	}

	/** 時間帯グリッドの項目（id は app-expo/features/search/constants.ts の timeSlots の値） */
	timeSlot(id: "morning" | "lunch" | "dinner" | "late_night"): Detox.NativeMatcher {
		return by.id(`search-time-slot-${id}`);
	}

	/** 同行者（シーン）グリッドの項目（id は sceneOptions の値） */
	scene(id: "solo" | "date" | "friends" | "family" | "drinking"): Detox.NativeMatcher {
		return by.id(`search-scene-${id}`);
	}

	/** 予算帯チップ（value は priceLevelOptions の値） */
	priceLevel(value: string): Detox.NativeMatcher {
		return by.id(`search-price-level-${value}`);
	}

	/** 交通手段ごとの所要時間チップ */
	distanceEstimate(mode: "walk" | "bike" | "car" | "train"): Detox.NativeMatcher {
		return by.id(`search-distance-estimate-${mode}`);
	}

	/**
	 * 検索画面が表示されていることを検証する。
	 *
	 * ⚠️ チュートリアルが自動表示されていた場合は **先に閉じてから**検証する。
	 * ネイティブのチュートリアルは BottomSheet（Android では別ウィンドウの Modal）として
	 * 描画され、その間は背後の検索フォームが Detox から見えなくなるため、
	 * 「チュートリアルが出ているせいで画面表示の検証に失敗する」誤検知を防ぐ必要がある。
	 * チュートリアルそのものを検証する spec は expectLoaded を呼ぶ前に検証すること。
	 *
	 * @param timeout タイムアウト (ms)
	 */
	async expectLoaded(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await this.dismissTutorialIfPresent();
		await waitUntilVisible(this.headerTitle, timeout);
	}

	/**
	 * 場所入力欄へ文字を入力する。
	 *
	 * #1031 【設計】`typeText` ではなく `replaceText` を使う。Android の Detox は Espresso の
	 * `typeTextIntoFocusedView` を使うため **ASCII 以外（= 日本語）を入力できない**。
	 * `replaceText` はプラットフォームを問わず任意の文字列を入れられ、RN の `onChangeText` も発火する。
	 *
	 * また `LocationAutocomplete` は `showSuggestions = 入力あり && フォーカス中` で候補を出すため、
	 * **入力前に必ずタップしてフォーカスを与える**（フォーカスが無いと候補パネルが開かない）。
	 *
	 * @param query 入力する地名（例: "渋谷"）
	 */
	async typeLocation(query: string): Promise<void> {
		await element(this.locationInput).tap();
		await element(this.locationInput).replaceText(query);
	}

	/**
	 * 入力済みの場所をクリアする（入力が無ければ何もしない）。
	 *
	 * チュートリアル完了済みの状態では画面表示時に現在地が自動取得され、場所が確定済みになることがある。
	 * 「場所未確定」を前提にする検証の前処理として使う（e2e-web の search-form.spec.ts と同じ考え方）。
	 * クリアボタンの押下は入力文字列だけでなく確定済みの location（検索の必須項目）も null に戻す。
	 *
	 * @returns クリアを実行した場合 true
	 */
	async clearLocationIfPresent(): Promise<boolean> {
		if (!(await existsNow(this.locationClearButton))) return false;

		await element(this.locationClearButton).tap();
		return true;
	}

	/**
	 * n 番目の場所サジェストを選択する。
	 *
	 * ⚠️ サジェスト選択（handleLocationSelect）は、候補の文言を入力欄へ反映した**あとで非同期に**
	 * 詳細取得 API (v1/locations/details) を呼び、その完了後にはじめて検索の必須項目である
	 * `location` が確定する。Detox には Playwright の `waitForResponse` に相当する API が無いが、
	 * Detox の同期機構が **未完了のネットワークリクエストがある間は次の操作をブロックする**ため、
	 * この直後に `submit()` してもリクエスト完了後にタップが実行される（utils/waits.ts の方針）。
	 *
	 * @param index 0 始まりのサジェスト番号
	 */
	async selectLocationSuggestion(index: number): Promise<void> {
		await waitUntilVisible(this.locationSuggestion(index));
		await element(this.locationSuggestion(index)).tap();
	}

	/** 時間帯を選択する */
	async selectTimeSlot(id: "morning" | "lunch" | "dinner" | "late_night"): Promise<void> {
		await element(this.timeSlot(id)).tap();
	}

	/** 同行者（シーン）を選択する */
	async selectScene(id: "solo" | "date" | "friends" | "family" | "drinking"): Promise<void> {
		await element(this.scene(id)).tap();
	}

	/** 詳細条件（距離・フードスタイル等）を展開する。画面外にある場合はスクロールしてから押す */
	async openAdvancedFilters(): Promise<void> {
		await this.scrollUntilVisible(this.advancedToggle, this.scrollAnchor);
		await element(this.advancedToggle).tap();
	}

	/** おすすめ外の移動時間チップの開閉を切り替える */
	async toggleOtherDistanceEstimates(): Promise<void> {
		await this.scrollUntilVisible(this.distanceEstimatesToggle, this.advancedToggle);
		await element(this.distanceEstimatesToggle).tap();
	}

	/** 検索を実行する */
	async submit(): Promise<void> {
		await element(this.submitButton).tap();
	}

	/**
	 * チュートリアルが自動表示されていることを検証する。
	 * ja-JP かつ未視聴（AsyncStorage の `search_tutorial_seen_v1` が未設定）のときだけ成立する。
	 */
	async expectTutorialShown(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.tutorialOverlay, timeout);
	}

	/**
	 * チュートリアルが表示されていないことを検証する。
	 *
	 * #1031 【設計】m6: e2e-web は `page.evaluate` で localStorage のフラグを直接読んでいるが、
	 * Detox からアプリの AsyncStorage は読めない。**「再訪問しても表示されない」という
	 * ユーザー観測可能な事実**で代替する。
	 */
	async expectTutorialAbsent(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.headerTitle, timeout);
		await expect(element(this.tutorialOverlay)).not.toExist();
	}

	/**
	 * チュートリアルを最後まで進めて完了させる。
	 *
	 * 最終ページのプライマリ CTA「はじめよう」は現在地取得（OS の位置情報アクセス）を伴うため、
	 * e2e-web と同じくセカンダリ CTA「あとで」で完了させる。どちらも `markTutorialAsSeen()` を通る。
	 *
	 * @param maxPages ページ送りの上限（無限ループ防止。現在のページ数は 4）
	 */
	async completeTutorial(maxPages = 10): Promise<void> {
		await waitUntilVisible(this.tutorialOverlay);

		// #1031 【設計】§4-1: ページ送りは FlatList のスクロールアニメーションを伴う。
		// プライマリ CTA の testID が「つぎへ」→「はじめよう」に切り替わることを毎回待ち合わせることで、
		// アニメーション完了を明示的に待つ（Detox の idle 同期だけに頼らない）
		for (let page = 0; page < maxPages; page += 1) {
			if (await existsNow(this.tutorialFinishButton, 1_000)) break;
			if (!(await existsNow(this.tutorialNextButton, 1_000))) break;

			await element(this.tutorialNextButton).tap();
		}

		await waitUntilVisible(this.tutorialFinishButton);
		await element(this.tutorialLaterButton).tap();
		await waitUntilGone(this.tutorialOverlay);
	}

	/**
	 * チュートリアルが出ていれば閉じる（ベストエフォート）。
	 *
	 * #1031 【設計】§4-3: e2e-web は fixtures が localStorage へ視聴済みフラグをシードして抑止しているが、
	 * ネイティブ側の AsyncStorage シード手段は共通基盤（#1030 の launchArgs 経路）にまだ無い。
	 * そのため各 spec は「出ていたら閉じる」で吸収する。
	 * シード方式が基盤に入ったらこの前処理は不要になる。
	 *
	 * @returns 閉じた場合 true / そもそも出ていなかった場合 false
	 */
	async dismissTutorialIfPresent(): Promise<boolean> {
		// チュートリアルは AsyncStorage の読み込み完了後に開くため、起動直後は少し遅れて現れる。
		// 「出ていない」と誤判定して後続の操作がブロックされないよう、既定より長めに様子を見る
		if (!(await existsNow(this.tutorialOverlay, 3_000))) return false;

		await this.completeTutorial();
		return true;
	}

	/**
	 * 対象が画面内に入るまでスクロールする。
	 *
	 * #1031 【設計】検索画面の ScrollView に testID が無く `whileElement().scroll()` を使えないため、
	 * スクロール領域内の実在要素を掴んで swipe することで代替する。
	 *
	 * @param target 画面内に入れたい要素
	 * @param anchor swipe の起点にする、スクロール領域内の要素
	 * @param maxSwipes swipe の上限回数
	 * @失敗時 上限まで swipe しても見えない場合、最後に Detox の waitFor で失敗させる（失敗理由を残すため）
	 */
	private async scrollUntilVisible(
		target: Detox.NativeMatcher,
		anchor: Detox.NativeMatcher,
		maxSwipes = 5,
	): Promise<void> {
		for (let i = 0; i < maxSwipes; i += 1) {
			const visible = await waitFor(element(target))
				.toBeVisible()
				.withTimeout(1_000)
				.then(() => true)
				.catch(() => false);
			if (visible) return;

			await element(anchor).swipe("up", "slow", 0.6);
		}

		await waitUntilVisible(target);
	}
}
