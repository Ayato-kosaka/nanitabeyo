import { describeAuthenticated, launchAppWithSession, localeDeepLink, waitUntilVisible } from "../../fixtures/e2e";
import { SavedDishCategoryLocationSearchScreen } from "../../screens/SavedDishCategoryLocationSearchScreen";
import { SearchScreen } from "../../screens/SearchScreen";
import { TabBar } from "../../screens/TabBar";
import { ensureSavedDishCategory } from "../../utils/savedDishCategory";

/**
 * 📌 保存した料理カテゴリからの地点検索（#1133 / #1369）
 *
 * 目的: 「保存した料理カテゴリのカードから開く地点検索が、ホーム（さがすタブ）と地続きであること」を保証する。
 *       対応する e2e-web: e2e-web/tests/profile/saved-dish-category-location-search.spec.ts
 *
 * ## #1369 でモーダルからルートになった
 * 器が BlurModal から «画面»（/[locale]/profile/saved-dish-category-location）へ変わった。
 * 中身（LocationSearchForm）と testID は据え置きなので下の 2 本はそのまま通るが、
 * 到達判定に画面ヘッダーを足し（SavedDishCategoryLocationSearchScreen.screenTitle）、
 * #528 の観点を 3 本目として **この画面に** 足してある（理由はそのテストのコメント）。
 *
 * ## なぜこのテストが要るか
 * #1133 以前、この地点検索は **素のテキスト入力だけ**だった。ホームには「現在地」も
 * 「最近使った場所」もあるのに、保存料理から検索するときだけ毎回地名を打ち直す必要があり、
 * 「保存した料理を近所で食べたい」という一番自然な導線が一番面倒だった。
 * #1133（PR #1168）はホームと同じ `LocationAutocomplete` を使い、履歴も
 * **同じ保存キー `recent_locations_v1` を共有**するように揃えた。
 *
 * ここで守りたいのは個々の部品の存在ではなく、その**共有**そのものである。
 * 部品は共有せず見た目だけ似せる実装（= 履歴が別キーに積まれる）でも
 * 「現在地ボタンがある」「最近使った場所パネルがある」は緑になってしまうため、
 * 2 本目のテストは履歴をシードせず **実際にホームで地点を選んでから**この画面を開く。
 * これが #1133 の設計上の肝を唯一検知できる観測になっている。
 *
 * ## 検証しないこと
 * - **現在地の実取得**: 押すと OS の位置情報許可ダイアログが出うるが、Detox には
 *   Playwright の `grantPermissions` + `setGeolocation` に相当する安定した手段が無い
 *   （SearchScreen.ts が current-location.spec.ts を移植していないのと同じ理由）。
 *   ネイティブでは「導線が存在すること」までを分担し、確定までは web 側が担保する。
 * - **パネルのはみ出し**（web の優先2）: Detox にビューポートを縮める API が無い。
 *
 * ## ログイン済み前提である理由
 * 入口は保存した料理カテゴリのカードだけで、匿名ユーザーには保存が無いのでこの画面を開けない。
 * `describeAuthenticated` は TEST_USER_* が無い環境で spec ごと skip する（fixtures/e2e.ts）。
 * さらに **テストユーザーが料理カテゴリを 1 件以上保存している**ことも前提になる。
 *
 * ## 前提を「人」ではなく「テスト」が用意する（CI で赤くなった反省）
 * 当初この前提は「TEST_USER_* で 1 件保存しておくこと」という *依頼* で表現していた。
 * 結果、誰かがマイページから保存を外しただけで **コード変更ゼロで CI が赤くなった**。
 * 環境に前提を置くテストは、いずれ必ずその環境の変化で落ちる。
 * そこで `beforeAll` で `ensureSavedDishCategory()` を呼び、保存が 0 件なら
 * 推薦 API から実在のカテゴリを 1 つ取って `reactions` へ save を入れる。
 * e2e-web が `stubSavedDishCategories` でやっていることの、スタブできない環境版。
 *
 * ## 書き込みについて（Tier の位置づけ）
 * 「最近使った場所」の追記先は端末の AsyncStorage だけなので本体は Tier 2 のままだが、
 * 上記の前提づくりだけは **dev DB の reactions へ 1 行書く**。ただし
 * - 書くのは **保存が 0 件のときだけ**（元からあれば触らない = 2 回目以降は書き込みゼロ）
 * - 対象は RLS で自分の行に限定される（他ユーザー・他テーブルへは影響しない）
 * - 作るのは run ごとの一時データではなく «テストユーザーに保存が 1 件ある» という恒常的な前提
 * なので `@mutation` タグは付けず tier1-2 に置く。消さない理由は utils/savedDishCategory.ts に書いた。
 */
describeAuthenticated("保存した料理カテゴリからの地点検索", () => {
	/**
	 * マイページへの直リンク。
	 *
	 * `?tab=saved-dish-categories` は付けない。iOS で効かなかった問題は #1272 で修正済みだが、
	 * この spec の主題は «保存料理カテゴリからの地点検索» であってディープリンクではないため、
	 * タブの切り替えは実 UI（タブバー）で行う（`openSavedDishCategoriesTab`）。
	 * ⚠️ #1402 で `?tab=` の仕組みごと無くなった（4 グリッドタブの廃止）。それを守っていた
	 * profile-tab-deep-link.test.ts も一緒に落としてある。ここへ来る導線は
	 * マイページの「保存した料理カテゴリ」の行 1 本だけになった。
	 */
	const profileDeepLink = localeDeepLink("profile");

	// 推薦 API はスコアリング + 翻訳を挟むため、既定の 120s では足りないことがある。
	// ⚠️ 入れた行は消さない（後始末を «しない» のが正しい理由は utils/savedDishCategory.ts の冒頭）
	beforeAll(async () => {
		await ensureSavedDishCategory();
	}, 180_000);

	// #1031 【バグ】beforeAll だと前のテストが残した画面状態（開いたままの画面等）を次が引き継ぎ、
	// タップがオーバーレイに阻まれて落ちる。セッション注入起動は匿名クォータを消費しないため、
	// テストごとに起動し直して独立性を担保する。
	// ⚠️ `resetState` は付けない。2 本目は 1 本目の続きではなく **同一テスト内で**履歴を積むが、
	// アプリのデータを消すと注入済みセッション以外のローカル状態も落ちるため触らない方針にする

	// ─ テストケース 1: カードを押すと地点検索画面が開き、現在地ボタンがある ─
	// 手順:
	//   1. 保存した料理カテゴリタブへ直リンクで起動する
	//   2. 先頭のカード（save-dish-category-tab-item-0）を押す
	//   3. 地点検索の入力欄（saved-dish-category-location-search-input）が表示されることを検証
	//   4. 現在地ボタン（saved-dishCategory-current-location-button）が表示されることを検証
	//      → #1133 の本体。以前はここに素のテキスト入力しか無かった
	it("カードを押すと地点検索画面が開き、現在地ボタンがある", async () => {
		const locationSearch = new SavedDishCategoryLocationSearchScreen();

		await launchAppWithSession({ as: "authenticated", url: profileDeepLink });

		await locationSearch.openLocationSearchFromFirstDishCategory();

		await waitUntilVisible(locationSearch.currentLocationButton);
	});

	// ─ テストケース 2: ホームで選んだ地点が「最近使った場所」に出て、押すと検索が確定する ─
	// 手順:
	//   1. さがすタブで「渋谷」を入力し、先頭のサジェストを選ぶ
	//      → ここで recent_locations_v1 へ 1 件積まれる（履歴のシードはしない。共有の検証そのものだから）
	//   2. 保存した料理カテゴリタブへ直リンクで開き直し、先頭のカードを押す
	//   3. 入力欄をタップしてフォーカスを与える
	//      （LocationAutocomplete の表示条件は「フォーカス中 && 入力が空 && 履歴が 1 件以上」）
	//   4. 最近使った場所パネル（-recent-locations）と先頭項目（-recent-location-0）が出ることを検証
	//      → ホームと同じ保存キーを共有していなければここで赤くなる
	//   5. 先頭項目を押し、マイページ配下の検索結果画面へ遷移することを検証
	it("ホームで選んだ地点が最近使った場所に出て、押すと検索が確定する", async () => {
		const search = new SearchScreen();
		const tabBar = new TabBar();
		const locationSearch = new SavedDishCategoryLocationSearchScreen();

		await launchAppWithSession({ as: "authenticated" });
		await tabBar.gotoSearch();
		await search.expectLoaded();

		// チュートリアル完了済みの状態では現在地が自動で入っていることがある。
		// 「渋谷」を確実に履歴の先頭へ積むため、入力を空に戻してから打ち直す
		await search.clearLocationIfPresent();
		await search.typeLocation("渋谷");
		// サジェスト選択は詳細取得 API の完了後に location が確定する。Detox の同期機構が
		// 未完了のリクエストの間は次の操作をブロックするため、この直後の遷移は完了後に走る
		await search.selectLocationSuggestion(0);

		await launchAppWithSession({ as: "authenticated", url: profileDeepLink });
		await locationSearch.openLocationSearchFromFirstDishCategory();
		await locationSearch.focusLocationInput();

		await waitUntilVisible(locationSearch.recentLocations);
		await waitUntilVisible(locationSearch.recentLocation(0));

		await locationSearch.selectRecentLocation(0);

		await locationSearch.expectSearchResultShown();
	});

	// ─ テストケース 3: 候補をタップすると地点が確定し、検索結果へ進む（#528 / #1369） ─
	// 手順:
	//   1. 保存した料理カテゴリタブへ直リンクで起動し、先頭のカードを押して地点検索画面へ
	//   2. 「渋谷」を入力し、候補リストと先頭項目の表示を待つ
	//   3. 先頭の候補をタップする ← #528 の再現操作
	//   4. マイページ配下の検索結果画面へ遷移することを検証（＝ 地点が «検索条件として» 確定した）
	//
	// ## なぜこの spec に足したのか（#528 の担保先がここへ移った）
	// #528 は「候補をタップしたのにキーボードだけ閉じて選択が反応しない」不具合で、原因は
	// **地点オートコンプリートを BlurModal の中に置いていたこと**だった
	//（親の KeyboardAvoidingView がタップ開始時に Keyboard.dismiss() を呼び、キーボード高の変化による
	//  レイアウト再計算で候補リストが unmount され、子の onPress が潰れる。詳細は
	//  tests/search/location-suggestion-tap.test.ts のヘッダ）。
	//
	// その «唯一の» 該当画面がこの地点検索で、#1369 のルート化で BlurModal ごと無くなっている。
	// tests/search/location-suggestion-tap.test.ts は当時「ここは保存カテゴリのシードが無く
	// 触れない」と書き残していたが、その前提は `utils/savedDishCategory.ts`（保存を 1 件作る）と
	// `save-dish-category-tab-item-<n>` の testID が入った時点で解消済み。**元の当事者の画面で、
	// 候補タップが選択として成立する**ことをここで直接押さえる。
	//
	// 観測点を入力欄の値ではなく遷移にしているのは location-suggestion-tap.test.ts と同じ理由
	//（Detox の toHaveValue / toHaveText は TextInput でプラットフォーム差が大きい）。
	// 遷移先はデータ読み込み中でも常に描画される閉じるボタンで判定する。
	it("候補をタップすると地点が確定し、検索結果画面へ進む", async () => {
		const locationSearch = new SavedDishCategoryLocationSearchScreen();

		await launchAppWithSession({ as: "authenticated", url: profileDeepLink });
		await locationSearch.openLocationSearchFromFirstDishCategory();

		await locationSearch.typeLocation("渋谷");
		await waitUntilVisible(locationSearch.suggestions);
		await waitUntilVisible(locationSearch.suggestion(0));

		await locationSearch.selectSuggestion(0);

		// #528 が再発すると onPress が走らず地点が確定しないため、ここへは到達できない
		await locationSearch.expectSearchResultShown();
	});
});
