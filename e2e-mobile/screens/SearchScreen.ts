import { strict as assert } from "node:assert";

import {
	DEFAULT_TIMEOUT,
	by,
	element,
	existsNow,
	multiTapWhenPresent,
	tapWhenPresent,
	tapWhenVisible,
	visibleNow,
	waitFor,
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
 * - **先読み画像の即時表示**（#1083 / e2e-web の tests/search/onboarding-preload.spec.ts）は
 *   **#1087 でプローブ方式に切り替えて観測できるようにした**。
 *   かつては「`expo-image` のキャッシュ状態を Detox から読む API が無く、<Image> に testID を足しても
 *   言えるのは要素の存在だけ（= 先読みブロックを消しても緑になる感度ゼロ）」という理由で移植を見送っていたが、
 *   観測点を Detox 側ではなく **アプリ側**に足すことで解決している:
 *   先読みの各 <Image> の `onLoad` / `onError` を数え、`loaded=<n>/<total>` を持つ
 *   `search-preload-probe` を E2E ビルド限定で描画する（app-expo/lib/e2e/preloadProbe.tsx）。
 *   検証は `expectPreloadImagesLoaded()`、spec は tests/search/preload-images.test.ts
 * - **現在地取得**（e2e-web の current-location.spec.ts）は移植していない。
 *   「拒否」「タイムアウト」の再現には起動時の権限設定を spec ごとに切り替える必要があるが、
 *   fixtures/e2e.ts の `platformLaunchOptions()` は権限を常に付与する固定実装のため、
 *   拒否ケースを表現できない。fixtures 側に権限を切り替える起動オプションが入ったら移植すること
 */
/**
 * 先読み対象の枚数（#1087 / #1486）。
 *
 * ⚠️ `app-expo/features/search/constants.ts` の `PRELOAD_IMAGES` と必ず対応させること
 * （オンボーディング 6 枚 + アプリアイコン + Apple / Google のロゴ = 9 枚）。
 * #1403 (PR1) レビューのヒーロー画像はレビュータブと一緒に削除され `PRELOAD_IMAGES` から
 * 消えている（main 側の #1486 と統合ブランチのマージで 10 → 9）。
 * e2e-web の `utils/preload-assets.ts` の `PRELOAD_ASSET_KEYS` と同じ位置づけ。
 */
export const PRELOAD_IMAGE_COUNT = 9;

/**
 * 先読み完了を待つ上限 (ms)。
 *
 * #1087 の修正後、Android エミュレータでの実測は **1873ms**（当時の 8 枚すべて `onLoad` まで）。
 * 先読み対象はバンドル同梱のローカルアセットで、実 API もネットワークも介さないため、
 * 実測とランナーの当たり外れを吸収できれば足りる。実測の約 5 倍を上限にしている:
 * - 短すぎると、エミュレータが冷えている初回実行（ディスク I/O が効く）でフレークする
 * - 長すぎると、再発時に赤くなるまで無駄に待たされる（当初の 20 秒はこちらの理由で縮めた）
 *
 * この上限を払うのは **失敗するときだけ**なので、通過時の実行時間には影響しない。
 */
export const PRELOAD_PROBE_TIMEOUT = 10_000;

/**
 * プローブ要素そのものの存在確認に費やす上限 (ms)。
 *
 * プローブは検索画面と同時にマウントされるため、`expectLoaded()` を通った時点で既に居るはず。
 * 「居ない = E2E ビルドではない」を素早く名指しで報告するための短い待ちで、
 * ロード完了を待つ `PRELOAD_PROBE_TIMEOUT` とは目的が違う。
 */
const PRELOAD_PROBE_PRESENCE_TIMEOUT = 3_000;

export class SearchScreen {
	/** 画面ヘッダのタイトル（i18n: Search.headerTitle） */
	readonly headerTitle = by.id("search-header-title");
	/** ヘッダーの「？」ボタン（オンボーディング再表示。ja-JP のときのみ表示される） */
	readonly helpButton = by.id("search-help-button");

	/** 場所オートコンプリートの入力欄 */
	readonly locationInput = by.id("search-location-autocomplete-input");
	/** 場所入力のクリアボタン（入力が 1 文字以上あるときだけ描画される） */
	readonly locationClearButton = by.id("search-location-autocomplete-clear");
	/** 場所サジェストのリスト */
	readonly locationSuggestions = by.id("search-location-autocomplete-suggestions");
	/** #1502 地点確認中(details 取得中)の表示。e2e-web の locationConfirming に対応 */
	readonly locationConfirming = by.id("search-location-autocomplete-confirmation-confirming");
	/** #1502 地点確定済みの表示 */
	readonly locationConfirmed = by.id("search-location-autocomplete-confirmation-confirmed");
	/**
	 * #1502 地点確認失敗の表示。
	 * ⚠️ 現時点では spec から未使用。details API を失敗させる手段が無いため(下記 selectLocationSuggestion
	 * のコメント参照)。testID 自体は実装済みなので、モック手段が入り次第 location-confirmation.test.ts へ追加すること
	 */
	readonly locationConfirmationError = by.id("search-location-autocomplete-confirmation-error");
	/** #1502 地点確認失敗時の再試行ボタン。上記と同じ理由で現時点では spec 未使用 */
	readonly locationConfirmationRetry = by.id("search-location-autocomplete-confirmation-retry");
	/** 「最近使った場所」のリスト（#953。e2e-web の recentLocationsList に対応）。
	 *  未入力でフォーカスしたときだけ描画される */
	readonly recentLocationsList = by.id("search-location-autocomplete-recent-locations");
	/** 「最近使った場所」を全件クリアするボタン（1件以上あるときだけ描画される） */
	readonly recentLocationsClearButton = by.id("search-location-autocomplete-recent-locations-clear");
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
	 * 先読み画像のロード枚数プローブ（#1087）。`loaded=<n>/<total>` の文字列を持つ。
	 *
	 * ⚠️ **E2E ビルド（`EXPO_PUBLIC_E2E_TUTORIAL_HOOK=1`）でしか存在しない。**
	 * 通常ビルドでは metro の resolver が noop 実装へ差し替えるため、要素ごと描画されない
	 *（app-expo/lib/e2e/preloadProbe.tsx）。
	 */
	readonly preloadProbe = by.id("search-preload-probe");
	/** プローブの内訳（`loaded=<n> error=<n> total=<n>`）。失敗時の切り分け専用 */
	readonly preloadProbeDetail = by.id("search-preload-probe-detail");

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

	/** n 番目の「最近使った場所」（0 始まり、先頭が最新） */
	recentLocation(index: number): Detox.NativeMatcher {
		return by.id(`search-location-autocomplete-recent-location-${index}`);
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
	 * #1027 オンボーディングの後始末はここでは行わない。起動引数 `e2eTutorialSeen` のシードで
	 * **そもそも開かない**設計に変えたため（fixtures/e2e.ts の `tutorialSeen` オプション）。
	 * 以前はここで「出ていたら閉じる」をしていたが、呼ばれるたびに数秒の probe が入るうえ、
	 * 遅れて被さる競合を消し切れなかった。
	 *
	 * @param timeout タイムアウト (ms)
	 */
	async expectLoaded(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.headerTitle, timeout);
	}

	/**
	 * 先読み画像（`PRELOAD_IMAGES`）が **全枚数ロードできた**ことを検証する（#1087）。
	 *
	 * ## 何を観測しているか
	 * アプリ側のプローブ（app-expo/lib/e2e/preloadProbe.tsx）が、先読みブロックの各 `<Image>` の
	 * `onLoad` / `onError` を数えて `loaded=<n>/<total>` を描画している。ここではその文字列を待つだけ。
	 * 「何 ms で表示されたか」ではなく **「何枚ロードできたか」という状態**を見るので、
	 * ランナーの速度ではフレークしない（e2e-web の onboarding-preload.spec.ts と同じ観測原則）。
	 *
	 * ## 感度
	 * 先読みブロックが 0×0 に戻ると expo-image の native 実装はロード要求を発行しない
	 *（iOS: `getBestSource` が size<=0 で nil / Android: `cleanIfNeeded` が width/height 0 で早期 return）。
	 * そのため `loaded=0/8` のまま動かず、このアサーションは赤くなる。
	 * app-expo 側の jest（searchScreenPreload.test.tsx）は style が非ゼロかまでしか見ないので、
	 * **expo-image の都合で実際にロードされなくなった変化を捕まえられるのはこちらだけ**。
	 *
	 * ## `toHaveText` を使う理由
	 * プローブは 1×1 の絶対配置で、他の要素を 1px も遮蔽しない（既存 spec の可視判定を壊さないため）。
	 * Detox の `toHaveText` は Espresso の `withText` / iOS の text 属性比較で、
	 * `toBeVisible` と違い可視面積を要求しないため、この極小要素でも読める。
	 *
	 * @param total 期待する枚数（既定 PRELOAD_IMAGE_COUNT）
	 * @param timeout タイムアウト (ms)
	 * @失敗時 実測値（`loaded=<n> error=<n> total=<n>`）を添えた日本語メッセージで例外を投げる。
	 *         プローブ要素自体が無い場合は「E2E ビルドでない」ことを名指しで報告する
	 */
	async expectPreloadImagesLoaded(
		total: number = PRELOAD_IMAGE_COUNT,
		timeout: number = PRELOAD_PROBE_TIMEOUT,
	): Promise<void> {
		// プローブが存在しない = ビルド時にフックが立っていない。ロード待ちを使い切ってから
		// 「テキストが一致しない」と報告されると原因の切り分けに時間を取られるので先に名指しで落とす
		if (!(await existsNow(this.preloadProbe, PRELOAD_PROBE_PRESENCE_TIMEOUT))) {
			throw new Error(
				[
					"先読み画像プローブ（search-preload-probe）が画面に存在しません。",
					"  このプローブは E2E ビルド限定で描画されます（app-expo/lib/e2e/preloadProbe.tsx）。",
					"  ビルド時に EXPO_PUBLIC_E2E_TUTORIAL_HOOK=1 が設定されていたか確認してください",
					"  （このフックは **バンドル時** に metro の resolver で有効/無効が決まります）。",
				].join("\n"),
			);
		}

		const expected = `loaded=${total}/${total}`;
		try {
			await waitFor(element(this.preloadProbe)).toHaveText(expected).withTimeout(timeout);
		} catch (error) {
			// ⚠️ このメッセージは **必ず実測値を載せること**。再発時に
			// 「ロード要求が飛んでいない（error=0）」のか「飛んだが取得に失敗した（error>0）」のかを
			// ログだけで切り分けられることが、このテストの価値そのもの
			const actual = await this.readPreloadProbeDetail();
			throw new Error(
				[
					`先読み画像が ${timeout}ms 以内に全枚数ロードされませんでした（期待: ${expected}）。`,
					`  プローブの実測値: ${actual}`,
					"  loaded=0 error=0 なら、native の expo-image がロード要求そのものを発行していません",
					"  （先読みブロックのサイズが 0 に戻った可能性。app-expo の search/index.tsx 末尾）。",
					"  error>0 なら、要求は飛んだが取得に失敗しています（アセット解決やキャッシュ側の問題）。",
					`  元の失敗: ${error instanceof Error ? error.message : String(error)}`,
				].join("\n"),
			);
		}
	}

	/**
	 * プローブの内訳テキストを読む（失敗時の切り分け専用。読めなければ理由を文字列で返す）。
	 *
	 * `getAttributes()` の戻り値は iOS / Android で型が分かれるため、`text` だけを拾う形に絞る
	 *（ResultScreen.ts の読み取りと同じ扱い）。
	 */
	private async readPreloadProbeDetail(): Promise<string> {
		try {
			const attributes = (await element(this.preloadProbeDetail).getAttributes()) as { text?: string };
			return attributes.text ?? "(text 属性を読めませんでした)";
		} catch (error) {
			return `(プローブを読めませんでした: ${error instanceof Error ? error.message : String(error)})`;
		}
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

	/**
	 * 場所入力欄をタップしてフォーカスを与える（#528）。
	 *
	 * `typeLocation()` から入力操作だけを切り離したもの。`LocationAutocomplete` は
	 * `showSuggestions = 入力あり && フォーカス中` で候補を出すため、**入力済みの文字列を消さずに
	 * 候補パネルだけ開き直したい**ときに使う。
	 */
	async focusLocationInput(): Promise<void> {
		await tapWhenVisible(this.locationInput);
	}

	/**
	 * 場所入力欄の現在値を読む（#528）。
	 *
	 * ⚠️ **アサーションの主観測点にはしないこと。** Detox の `toHaveValue` / `toHaveText` は
	 * TextInput に対する挙動がプラットフォームで揺れる（location-autocomplete.test.ts の
	 * ヘッダに既に書いてあるとおり、既存 spec は「クリアボタンの有無」へ置き換えている）。
	 * ここで `getAttributes()` を使うのは **「入力欄に何かが入った」ことを補助的に見る**ためで、
	 * 「選択が成立した」の判定は検索が通ること（`submit()` 後に画面が進むこと）で行う。
	 *
	 * 戻り値の型が iOS / Android で分かれるため `text` だけを拾う形に絞る
	 * （`readPreloadProbeDetail()` / ResultScreen.ts の読み取りと同じ扱い）。
	 *
	 * @returns 入力欄のテキスト。読めなかった場合は空文字
	 */
	async readLocationInputText(): Promise<string> {
		try {
			const attributes = (await element(this.locationInput).getAttributes()) as { text?: string };
			return attributes.text ?? "";
		} catch {
			// 「まだ描画されていない」「属性を読めない」はどちらも空扱いにする。
			// 呼び出し側は「空でないこと」を見るため、読めなければ素直に失敗すればよい
			return "";
		}
	}

	/**
	 * 場所入力欄のリターンキーを押してキーボードを閉じる（#528 / ベストエフォート）。
	 *
	 * `clearLocationIfPresent()` が内部で使っているものと同じ操作を spec から呼べるようにしたもの。
	 * Detox にプラットフォーム共通の「キーボードを閉じる」API は無く、Android は IME 自体を
	 * 無効化してある（scripts/setup-android-locale.sh）ためそもそもキーボードが出ない。
	 * **失敗しても検証を止めない**（環境差で落ちても、その失敗は検証したい事実と無関係なため）。
	 */
	async dismissKeyboardIfOpen(): Promise<void> {
		await this.dismissKeyboard();
	}

	/**
	 * 「最近使った場所」パネルを表示する（e2e-web の openRecentLocations に対応）。
	 *
	 * `LocationAutocomplete` は「入力が空 && フォーカス中」のときだけこのパネルを出す
	 * （showRecentLocations の条件）。`clearLocationIfPresent` はクリア後にリターンキーで
	 * キーボードを閉じてしまう（= blur してパネルが閉じる）ため、そのあとで
	 * 明示的に入力欄をタップし直してフォーカスを確定させる。
	 */
	async openRecentLocations(): Promise<void> {
		await this.clearLocationIfPresent();
		await tapWhenVisible(this.locationInput);
		await waitUntilVisible(this.recentLocationsList);
	}

	/**
	 * n 番目の「最近使った場所」の accessibilityLabel（= `RecentLocation.locationQuery`）を読み取る。
	 *
	 * 実 API の検索結果は地名も件数も事前に確定できないため、e2e-web のように入力欄の値を
	 * 直接アサートするのではなく、ResultScreen の likeLabel と同じ「ラベルを読んで比較する」
	 * 方式に倣う（値そのものではなく、選び直し前後で一致/変化したことを検証する）。
	 */
	async recentLocationLabel(index: number): Promise<string> {
		return readLabel(this.recentLocation(index), 0);
	}

	/** 時間帯を選択する */
	async selectTimeSlot(id: "morning" | "lunch" | "dinner" | "late_night"): Promise<void> {
		await tapWhenVisible(this.timeSlot(id));
	}

	/** 同行者（シーン）を選択する */
	async selectScene(id: "solo" | "date" | "friends" | "family" | "drinking"): Promise<void> {
		await tapWhenVisible(this.scene(id));
	}

	/**
	 * 詳細条件（距離・フードスタイル等）を展開する。画面外にある場合はスクロールしてから押す。
	 *
	 * ⚠️ **まず先頭へ戻すこと。** `scrollUntilVisible` は «下方向» にしか送らないので、
	 * 既に詳細条件より下まで進んでいる状態から呼ぶと永久に届かない。
	 *
	 * ## ここで 4 連続で赤くなった本当の理由（テストではなくアプリの不具合だった）
	 * iOS で `Unable to scroll down ... does not pass visibility percent threshold (75)` が
	 * 出続けた（run 31607285195 / 31624910689 / 31644130515 / 31675500414）。
	 * 「スクロールが足りない」ではなく **どこまでスクロールしても届かない**状態だった:
	 *
	 * - 詳細条件トグルは検索フォームの **最後の要素**で、その下は 100px の余白と検索 FAB しかない
	 * - つまりトグルが到達できる一番上の位置でも、画面の下から 150px 程度のところまでしか上がらない
	 * - iOS のキーボードは画面に **覆いかぶさる**（Android の adjustResize と違い画面が縮まない）ので、
	 *   下半分が潰れている間はトグルが可視領域に入る «スクロール量が存在しない»
	 *
	 * これは E2E だけの話ではなく、実ユーザーも同じ壁に当たる。現在地の取得に失敗すると
	 * `LocationAutocomplete` が手入力へ誘導するため自動で `focus()` する（#932）ので、
	 * 「自分では何も触っていないのに詳細条件が押せない」という詰みが起きていた。
	 * 直したのはアプリ側（search/index.tsx に `keyboardDismissMode="on-drag"`）で、
	 * ドラッグすればキーボードが閉じる = スクロールすれば必ず届くようになった。
	 */
	async openAdvancedFilters(): Promise<void> {
		// アプリ側の `keyboardDismissMode="on-drag"` により、下の `scrollTo` / `scroll` が
		// そのままキーボードを閉じる。それでも明示的に閉じておくのは、
		// **キーボードが «あとから開き直る»** ため（現在地取得の失敗は非同期に来る。#932）。
		// 「閉じる → スクロールして探す」を 1 回だけやると、その間に開き直されて詰む可能性が残る。
		const ATTEMPTS = 3;
		for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
			await element(this.scrollView).scrollTo("top");
			await this.dismissKeyboard();
			try {
				await this.scrollUntilVisible(this.advancedToggle);
				await tapWhenVisible(this.advancedToggle);
				return;
			} catch (error) {
				if (attempt === ATTEMPTS) {
					throw new Error(
						[
							`詳細条件トグル（search-advanced-toggle）を ${ATTEMPTS} 回試しても押せませんでした。`,
							"  ソフトキーボードがトグルを覆っている可能性が高いです（iOS では画面下半分を占有します）。",
							"  トグルはフォームの最後の要素なので、覆われている間は «届くスクロール量が存在しません»。",
							"  アプリ側の search/index.tsx から keyboardDismissMode が消えていないか確認してください。",
							`  元の失敗: ${error instanceof Error ? error.message : String(error)}`,
						].join("\n"),
					);
				}
			}
		}
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
	 * 検索ボタンを **待機を挟まずに** 連打する（#1084 P1/P2）。
	 *
	 * ⚠️ `submit()` の連続呼び出しでは連打にならない。Android は Detox の同期機構が有効で、
	 * 1 発目のあと画面遷移とネットワークの完了を待ってから 2 発目が飛ぶため、
	 * 連打事故が起きる脆弱な窓を確実に外してしまう（詳細は `multiTapWhenPresent`）。
	 *
	 * @param times 連打回数。遷移が起きるケースでは 2 に留めること
	 *              （3 発目以降は遷移後の画面の同じ座標へ落ちる）
	 */
	async submitRapid(times = 2): Promise<void> {
		await multiTapWhenPresent(this.submitButton, times);
	}

	/**
	 * オンボーディングが表示されていないことを検証する（#1486）。
	 *
	 * #1031 【設計】m6: e2e-web は `page.evaluate` で localStorage のフラグを直接読んでいるが、
	 * Detox からアプリの AsyncStorage は読めない。**「再起動しても表示されない」という
	 * ユーザー観測可能な事実**で代替する。
	 *
	 * 観測点をヘッダータイトルと «オンボーディングの「次へ」» の 2 つにしているのは、
	 * 「検索画面に居る」ことと「オンボーディングに覆われていない」ことが別の事実だから。
	 * 検索画面はオンボーディングの背後にマウントされたまま残るので、片方だけでは足りない。
	 */
	async expectOnboardingAbsent(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.headerTitle, timeout);
		const shown = await visibleNow(by.id("onboarding-next"), 3_000);
		assert.equal(shown, false, "再起動後にオンボーディングが再表示されている（既読フラグが永続化されていない）");
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
		await waitFor(element(target)).toBeVisible().whileElement(this.scrollView).scroll(pixels, "down", 0.5, 0.5);
	}
}

/**
 * 指定要素の accessibilityLabel を取得する（ResultScreen.ts の readLabel と同じ仕組み）。
 *
 * `getAttributes()` の戻り値は iOS / Android・単一 / 複数一致で型が分かれるが、
 * `atIndex()` で 1 件に絞っているため `label` を持つ形にしかならない。
 * 型定義がその絞り込みを表現できないので、ここで局所的に吸収する。
 */
async function readLabel(matcher: Detox.NativeMatcher, index: number): Promise<string> {
	const attributes = (await element(matcher).atIndex(index).getAttributes()) as { label?: string };
	return attributes.label ?? "";
}
