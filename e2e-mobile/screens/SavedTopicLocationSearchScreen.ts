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
 * 📌 保存した料理カテゴリ（マイページ）の地点検索モーダルの Screen Object（#1133）
 *
 * 対応画面: app-expo/features/profile/tabs/SavedTopicsTab.tsx が
 *          `features/profile/components/LocationSearchForm.tsx` を
 *          `testID="saved-topic-location-search"` で描画したもの。
 * 対応する e2e-web の Page Object: e2e-web/pages/ProfilePage.ts（#1133 の web 側対応）
 *
 * ## この Screen Object が必要な理由
 * #1133 以前、このモーダルは**素のテキスト入力だけ**だった。ホーム（さがすタブ）には
 * 「現在地」と「最近使った場所」があるのに、保存料理からの検索だけ毎回地名を打ち直す必要があった。
 * #1133（PR #1168）はホームと**同じ `LocationAutocomplete` / 同じ保存キー `recent_locations_v1`**を
 * 使うように揃えた。つまりこのモーダルの価値は「ホームと地続きであること」そのものなので、
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
 * 現在地ボタン（`saved-topic-current-location-button`）は **存在と可視までを見る**。
 * 押すと OS の位置情報許可ダイアログが出うるが、Detox には Playwright の `grantPermissions` +
 * `setGeolocation` に相当する安定した手段が無い（SearchScreen.ts の「現在地取得を移植していない」
 * 理由と同じ）。web 側の saved-topic-location-search.spec.ts が現在地確定まで担保するので、
 * ネイティブでは「導線が存在すること」までを分担する。
 */
export class SavedTopicLocationSearchScreen {
	/** 保存した料理カテゴリのグリッド（SaveTopicTab の GridList） */
	readonly grid = by.id("save-topic-tab-grid");

	/** 地点検索の入力欄（LocationAutocomplete が `${testID}-input` を組み立てる） */
	readonly locationInput = by.id("saved-topic-location-search-input");
	/** 入力欄右端の「現在地を使う」ボタン（LocationSearchForm にハードコードされた testID） */
	readonly currentLocationButton = by.id("saved-topic-current-location-button");
	/** 「最近使った場所」パネル（入力が空 && フォーカス中 && 履歴が 1 件以上のときだけ描画される） */
	readonly recentLocations = by.id("saved-topic-location-search-recent-locations");
	/** 候補（サジェスト）リスト */
	readonly suggestions = by.id("saved-topic-location-search-suggestions");

	/**
	 * 遷移先（マイページ配下の検索結果画面）の到達判定に使う閉じるボタン。
	 *
	 * `app/[locale]/(tabs)/profile/search-results.tsx` には testID を持つ要素が無かったため、
	 * #1133 のこの spec に合わせて閉じるボタンへ追加した。地図やリストは読み込み状態で
	 * 出たり消えたりするが、このボタンは常に描画されるので観測点として安定している。
	 */
	readonly searchResultCloseButton = by.id("profile-search-result-close-button");

	/** n 番目の保存料理カテゴリのカード（0 始まり） */
	topicCard(index: number): Detox.NativeMatcher {
		return by.id(`save-topic-tab-item-${index}`);
	}

	/** n 番目の「最近使った場所」（0 始まり） */
	recentLocation(index: number): Detox.NativeMatcher {
		return by.id(`saved-topic-location-search-recent-location-${index}`);
	}

	/** n 番目の候補（0 始まり） */
	suggestion(index: number): Detox.NativeMatcher {
		return by.id(`saved-topic-location-search-suggestion-${index}`);
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
	 * 先頭の保存料理カテゴリのカードを押して、地点検索モーダルを開く。
	 *
	 * @失敗時 保存が 0 件のときは **前提条件の不足**として日本語で名指しで落とす。
	 *   モーダルの入口はこのカードしかないため、ここで素通しにすると
	 *   「テストは緑だがモーダルを一度も開いていない」という嘘の緑になる（fail-loud の方針）。
	 *   e2e-web は `stubSavedDishCategories` で一覧 API を固定して同じ問題を回避しているが、
	 *   Detox にネットワークをスタブする手段は無いため、テストユーザーのデータに依存する。
	 */
	async openLocationSearchFromFirstTopic(): Promise<void> {
		await this.expectTabLoaded();

		if (!(await existsNow(this.topicCard(0)))) {
			throw new Error(
				[
					"保存した料理カテゴリが 0 件のため、地点検索モーダルを開けませんでした（save-topic-tab-item-0 が存在しない）。",
					"  このモーダルの入口は保存料理カテゴリのカードだけです。",
					"  TEST_USER_* のテストユーザーで料理カテゴリを 1 件以上保存しておいてください。",
				].join("\n"),
			);
		}

		await tapWhenVisible(this.topicCard(0));
		await waitUntilVisible(this.locationInput);
	}

	/**
	 * 「最近使った場所」パネルを表示させる。
	 *
	 * `LocationAutocomplete` の表示条件は `isFocused && 入力が空 && 履歴が 1 件以上`。
	 * モーダルは `autofocus` 付きで開くので通常は開いた時点で出ているが、
	 * フォーカスがアニメーションの都合で遅れる端末があるため **明示的にタップして**確定させる。
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
	 * マイページ配下の検索結果画面へ遷移したことを検証する。
	 *
	 * 遷移先は `/[locale]/(tabs)/profile/search-results`。到達直後は店舗データの読み込み中
	 * （RestaurantLoading が全面に被さる）なので、**中身ではなくヘッダの閉じるボタン**を待つ。
	 */
	async expectSearchResultShown(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.searchResultCloseButton, timeout);
	}
}
