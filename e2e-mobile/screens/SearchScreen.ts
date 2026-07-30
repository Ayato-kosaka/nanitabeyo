import { strict as assert } from "node:assert";

import {
	DEFAULT_TIMEOUT,
	by,
	dismissSearchTutorialIfPresent,
	element,
	existsNow,
	tapWhenPresent,
	tapWhenVisible,
	visibleNow,
	waitFor,
	waitUntilNotVisible,
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

	/**
	 * 検索チュートリアル（BottomSheet）のコンテンツ全体。
	 *
	 * ⚠️ #1027 この testID は扱いが難しく、**アサーションの観測点には使わないこと**。
	 * - Android では **常に 2 つの View に一致する**（TrueSheet がシートの内容をツリーへ二重に載せる）。
	 *   index を指定せずに待つと Detox は "matches 2 views in the hierarchy" で失敗する
	 * - iOS では表示中でも `toBeVisible` が 2 分待って成立しなかった（面積を持つ実体が無いため）
	 *
	 * 「チュートリアルが出ている / 出ていない」の判定には、実体のあるボタン
	 * （`tutorialNextButton` = 1 ページ目の「つぎへ」）を使う。
	 */
	readonly tutorialOverlay = by.id("search-tutorial-overlay");
	/**
	 * ⚠️ #1027 **TrueSheet の中身は Android で必ず 2 つの View に一致する**（run 30445542854 で実測。
	 * 2 件は id も座標も同一の重複エントリ）。シート内の要素を扱うヘルパには必ずこの添字を渡すこと。
	 */
	private static readonly TUTORIAL_INDEX = 0;
	/** チュートリアルの「つぎへ」（最終ページ以外で描画される） */
	readonly tutorialNextButton = by.id("search-tutorial-next");
	/** チュートリアルの「はじめよう」（最終ページのプライマリ CTA。押すと現在地取得が走る） */
	readonly tutorialFinishButton = by.id("search-tutorial-finish");
	/** チュートリアルの「あとで」（最終ページのセカンダリ CTA。現在地取得を伴わずに完了する） */
	readonly tutorialLaterButton = by.id("search-tutorial-later");

	/**
	 * 検索フォーム全体を包む縦スクロール領域（#1027 で app-expo 側に testID を追加）。
	 *
	 * 以前は testID が無く、代わりに「スクロール領域内の小さな要素を swipe する」方式を採っていたが、
	 * Detox の `swipe` は **掴んだ要素の高さの範囲内**でしか指を動かせない。
	 * 起点にしていた `search-scene-solo` は数十 px のタイルで、5 回スワイプしても画面下部の
	 * `search-advanced-toggle` まで到達できなかった（run 30432596949 で実測）。
	 */
	private readonly scrollView = by.id("search-scroll-view");

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
	 * #1027 チュートリアルの後始末はここでは行わない。起動引数 `e2eTutorialSeen` のシードで
	 * **そもそも開かない**設計に変えたため（fixtures/e2e.ts の `tutorialSeen` オプション）。
	 * 以前はここで「出ていたら閉じる」をしていたが、呼ばれるたびに数秒の probe が入るうえ、
	 * シートが遅れて被さる競合を消し切れなかった。
	 *
	 * @param timeout タイムアウト (ms)
	 */
	async expectLoaded(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
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
		await tapWhenVisible(this.locationInput);
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

		await tapWhenVisible(this.locationClearButton);

		// #1027 【バグ】クリアは **意図的に入力欄へフォーカスを戻す**（`LocationAutocomplete` の
		// handleClear が `inputRef.current?.focus()` を呼ぶ。クリア直後に手入力へ移れるようにする仕様）。
		// その結果 iOS ではソフトウェアキーボードが画面下半分を覆い、下端固定の検索 FAB を
		// Detox が「見えない/叩けない」と判定する（run 30522949349 の可視性デバッグ画像で確認）。
		// この入力欄は `onSubmitEditing` を持たず `blurOnSubmit` も既定（true）なので、
		// リターンキーは **副作用なく blur してキーボードを閉じる**だけで済む。
		await this.dismissKeyboard();
		return true;
	}

	/**
	 * 入力欄のリターンキーを押してキーボードを閉じる（ベストエフォート）。
	 *
	 * Detox にプラットフォーム共通の「キーボードを閉じる」API は無い。
	 * Android は IME 自体を無効化してあるため（scripts/setup-android-locale.sh）そもそも不要で、
	 * 環境によって失敗しうるので **失敗しても検証を止めない**。
	 */
	private async dismissKeyboard(): Promise<void> {
		try {
			await element(this.locationInput).tapReturnKey();
		} catch {
			// キーボードが出ていない環境（IME 無効の Android 等）では失敗しうる。無視して続行する
		}
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
		await tapWhenVisible(this.locationSuggestion(index));
	}

	/** 時間帯を選択する */
	async selectTimeSlot(id: "morning" | "lunch" | "dinner" | "late_night"): Promise<void> {
		await tapWhenVisible(this.timeSlot(id));
	}

	/** 同行者（シーン）を選択する */
	async selectScene(id: "solo" | "date" | "friends" | "family" | "drinking"): Promise<void> {
		await tapWhenVisible(this.scene(id));
	}

	/** 詳細条件（距離・フードスタイル等）を展開する。画面外にある場合はスクロールしてから押す */
	async openAdvancedFilters(): Promise<void> {
		await this.scrollUntilVisible(this.advancedToggle);
		await tapWhenVisible(this.advancedToggle);
	}

	/** おすすめ外の移動時間チップの開閉を切り替える。画面外にある場合はスクロールしてから押す */
	async toggleOtherDistanceEstimates(): Promise<void> {
		await this.scrollUntilVisible(this.distanceEstimatesToggle);
		await tapWhenVisible(this.distanceEstimatesToggle);
	}

	/**
	 * 検索を実行する。
	 *
	 * #1027 【バグ】ここだけは可視ではなく **存在**で待つ。この FAB は画面下端に絶対配置されており、
	 * iOS の `toBeVisible`（面積の 75% 以上が可視かつ非遮蔽）を満たせず 25 秒タイムアウトする
	 *（run 30493326741 で実測。ソフトウェアキーボードを無効化しても再現した）。
	 * Artifact のスクリーンショットではボタンははっきり描画されており、タップ自体は届く。
	 * 同じ「画面下端に来る要素」である距離セクションも、spec 側で既に `toExist` へ倒してある。
	 */
	async submit(): Promise<void> {
		await tapWhenPresent(this.submitButton);
	}

	/**
	 * チュートリアルが自動表示されていることを検証する。
	 * ja-JP かつ未視聴（AsyncStorage の `search_tutorial_seen_v1` が未設定）のときだけ成立する。
	 */
	async expectTutorialShown(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		// #1027 観測点は overlay ではなく **1 ページ目の「つぎへ」ボタン**にする。
		// overlay は「シートの内容を包むだけの View」で面積や重なりの扱いがプラットフォームで揺れ、
		// iOS では 2 分待っても toBeVisible が成立しなかった（run 30432596949）。
		// ボタンなら「チュートリアルが出ていて操作できる」という検証したい事実と 1:1 で対応する
		await waitUntilVisible(this.tutorialNextButton, timeout, SearchScreen.TUTORIAL_INDEX);
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
		// #1027 「存在しない」ではなく「見えていない」で判定する。
		// TrueSheet はシートを閉じていても内容をツリーに残すことがあり（Android では overlay が
		// 常に 2 つの View に一致する）、存在での判定はプラットフォーム差に巻き込まれる。
		// ユーザーから観測できる事実（チュートリアルが見えていない）を直接検証する
		const shown = await visibleNow(this.tutorialNextButton, 3_000, SearchScreen.TUTORIAL_INDEX);
		assert.equal(shown, false, "再起動後にチュートリアルが再表示されている（視聴済みフラグが永続化されていない）");
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
		await waitUntilVisible(this.tutorialNextButton, DEFAULT_TIMEOUT, SearchScreen.TUTORIAL_INDEX);

		// #1031 【設計】§4-1: ページ送りは FlatList のスクロールアニメーションを伴う。
		// プライマリ CTA の testID が「つぎへ」→「はじめよう」に切り替わることを毎回待ち合わせることで、
		// アニメーション完了を明示的に待つ（Detox の idle 同期だけに頼らない）
		for (let page = 0; page < maxPages; page += 1) {
			if (await existsNow(this.tutorialFinishButton, 1_000, SearchScreen.TUTORIAL_INDEX)) break;
			if (!(await existsNow(this.tutorialNextButton, 1_000, SearchScreen.TUTORIAL_INDEX))) break;

			await tapWhenVisible(this.tutorialNextButton, DEFAULT_TIMEOUT, SearchScreen.TUTORIAL_INDEX);
		}

		await waitUntilVisible(this.tutorialFinishButton, DEFAULT_TIMEOUT, SearchScreen.TUTORIAL_INDEX);
		await tapWhenVisible(this.tutorialLaterButton, DEFAULT_TIMEOUT, SearchScreen.TUTORIAL_INDEX);
		// #1027 閉じ待ちは「見えなくなること」で行う。TrueSheet の中身はツリーから消えるとは限らず、
		// 存在での判定はプラットフォーム差に巻き込まれる
		await waitUntilNotVisible(this.tutorialLaterButton, DEFAULT_TIMEOUT, SearchScreen.TUTORIAL_INDEX);
	}

	/**
	 * チュートリアルが出ていれば閉じる（ベストエフォート）。
	 *
	 * #1027 【設計】§4-3: e2e-web は fixtures が localStorage へ視聴済みフラグをシードして抑止している。
	 * ネイティブも起動引数 `e2eTutorialSeen` によるシード方式へ揃えたため、
	 * **通常の spec からこれを呼ぶ必要は無い**（`launchAppWithSession` の既定が「視聴済み」）。
	 * シードを外して起動した spec の後片付け用に残している。
	 *
	 * @returns 閉じた場合 true / そもそも出ていなかった場合 false
	 */
	async dismissTutorialIfPresent(): Promise<boolean> {
		// 実体は fixtures/e2e.ts。screens 側と二重管理にならないよう委譲するだけにする
		return dismissSearchTutorialIfPresent(3_000);
	}

	/**
	 * 対象が画面内に入るまでスクロールする。
	 *
	 * Detox の `whileElement(...).scroll()` は「見えるまでスクロールを繰り返す」を 1 つの式で表せる
	 * 公式の手段で、スクロール量も要素サイズに縛られない。
	 *
	 * @param target 画面内に入れたい要素
	 * @param pixels 1 回あたりのスクロール量 (px)
	 * @失敗時 スクロールし切っても見えない場合、Detox の例外を投げる
	 */
	private async scrollUntilVisible(target: Detox.NativeMatcher, pixels = 300): Promise<void> {
		// #1027 【バグ】スクロールの開始点を明示する。既定の開始点はスクロール領域の**下端寄り**で、
		// iOS ではそこがタブバー・検索 FAB・ホームインジケータに覆われているため
		// "View is not scrollable at the given start point"（= その点は見えていない）で失敗する
		// （run 30460621899 の iOS で実測）。中央（0.5, 0.5）から始めれば何にも覆われない
		await waitFor(element(target))
			.toBeVisible()
			.whileElement(this.scrollView)
			.scroll(pixels, "down", 0.5, 0.5);
	}
}
