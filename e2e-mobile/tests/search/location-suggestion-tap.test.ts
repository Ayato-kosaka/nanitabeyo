import { strict as assert } from "node:assert";

import {
	element,
	expect,
	launchAppWithSession,
	visibleNow,
	waitUntilGone,
	waitUntilNotVisible,
	waitUntilVisible,
} from "../../fixtures/e2e";
import { SearchScreen } from "../../screens/SearchScreen";
import { DishCategoriesScreen } from "../../screens/DishCategoriesScreen";

/**
 * 📍 場所オートコンプリートの「候補タップで地点が選択される」回帰テスト（実 API / Tier 2）
 *
 * 対応 Issue: #528「アプリ初回起動時、オートコンプリート候補をタップするとキーボードだけ閉じて
 *             選択が反応しない」／ 修正 PR #1180
 *
 * ## この spec が守るもの
 * #1180 以前は `useBlurModal` の `KeyboardAvoidingView` が
 * `onStartShouldSetResponder={() => { Keyboard.dismiss(); return false; }}` を持っており、
 *
 *   候補タップ**開始** → 親が Keyboard.dismiss() → キーボード高の変化でレイアウト再計算
 *   → 候補リストが unmount → 子の onPress がキャンセル
 *
 * となって「キーボードだけ閉じて選択が反応しない」状態になっていた。
 * 修正はこの副作用を親から外し、キーボードを閉じる責務を **候補を押された子側**
 *（`LocationAutocomplete` / `DishCategoryAutocomplete` の `handleSuggestionPress`）へ移したもの。
 *
 * ⚠️ アプリ側の単体テスト（app-expo の `LocationAutocomplete.test.tsx`）は
 * 「子が `Keyboard.dismiss()` を呼ぶ」という**実装の形**を固定している。
 *（対になっていた `useBlurModal.test.tsx` の「親がレスポンダを奪わない」ぶんは、
 * #1350 P6 で BlurModal ごと撤去された。親そのものが居なくなったので固定対象も消えている）
 * ここで守るのはその 1 段上、**「ユーザーが候補を押したら地点が本当に確定する」**という結果である。
 * 実装の形が変わっても（例えば別の方法でキーボードを閉じるようになっても）、
 * 結果が壊れたときにだけ赤くなるのがこの spec の役割。
 *
 * ## 「選択が成立した」の観測点を “入力欄の値” にしていない理由
 * `location-autocomplete.test.ts` のヘッダにあるとおり、Detox の `toHaveValue` / `toHaveText` は
 * TextInput に対する挙動がプラットフォームで揺れるため、既存 spec は入力欄の**値**の
 * アサーションを避けている。ここも同じ方針に従い、主観測点は
 *
 *   **「地点が確定したので検索が成立し、トピック画面へ進む」**
 *
 * とする。#528 が再発すると `handleLocationSelect` が呼ばれず検索の必須項目である `location` が
 * null のままになるため、検索ボタンは `global-snackbar` を出して遷移をガードする
 *（`search-form.test.ts` の「場所が未確定のまま検索するとバリデーション通知が出て遷移しない」が
 * まさにその状態を検証している）。つまりこの spec と search-form.test.ts は表裏の関係にある。
 *
 * 入力欄の値は `getAttributes()` で**補助的に**だけ見る（「何も入っていない」＝ 明らかな失敗を、
 * 検索まで進まずに素早く名指しで報告するため）。
 *
 * ## トピック生成（AI）の完了は待たない
 * 観測点は `dish-categories-header-title` の表示までに留め、`DishCategoriesScreen.expectLoaded()`（カードの描画待ち＝
 * AI 生成の完了待ちで実測数十秒）は呼ばない。この spec が見たいのは「地点が確定して遷移したか」であって
 * トピック生成の成否ではなく、そこは `dish-categories-flow.test.ts` が担当している。
 *
 * ## e2e-web との対応
 * e2e-web は `tests/search/location-autocomplete.spec.ts` の
 * 「mousedownを250ms保持するスロークリックでもサジェストを選択できる」(#991) が同じ
 * 「候補を押したのに選択が成立しない」クラスの不具合を守っている。ただし原因は Web 固有
 *（mousedown → blur の競合）で、#528 はネイティブ固有（キーボード高の変化によるレイアウト再計算）。
 * **同じ症状に対する、プラットフォームごとの別々の回帰テスト**という関係になる。
 */
describe("場所オートコンプリートの候補タップ（実 API / #528）", () => {
	const search = new SearchScreen();
	const dishCategories = new DishCategoriesScreen();

	// #1027 【バグ】beforeAll だと前のテストが残した状態（開いたキーボード・スクロール位置・遷移先の画面）を
	// 次のテストが引き継ぐ。とくにこの spec は 1 本目で画面遷移するため、テストごとに起動し直して
	// 独立性を担保する。セッション注入起動は匿名クォータを消費しない（fixtures/e2e.ts）
	beforeEach(async () => {
		// #1030 【設計】3-1: 匿名サインインのクォータを消費しないよう、確立済みセッションを注入して起動する
		await launchAppWithSession({ as: "anon" });
		await search.expectLoaded();
	});

	// ─ テストケース: 候補をタップすると、その地点が実際に選択される ─
	// 手順:
	//   1. 自動取得された現在地が入っている可能性があるため、明示的にクリアして「場所未確定」を作る
	//   2. 場所入力欄をタップしてフォーカスし、「渋谷」を入力する（フォーカスが無いと候補パネルが開かない）
	//   3. サジェストリストと先頭項目の表示を待つ
	//   4. 先頭の候補をタップする ← #528 の再現操作
	//   5. サジェストリストが閉じ、入力欄には候補の文言が入っている（＝ 空に戻っていない）ことを検証
	//   6. 検索を実行し、バリデーション通知が出ずにトピック画面へ進むことを検証
	//      （＝ 地点が「入力欄の見た目」だけでなく検索条件として確定している）
	it("候補をタップするとその地点が選択され、検索がトピック画面へ進む", async () => {
		await search.clearLocationIfPresent();

		await search.typeLocation("渋谷");
		await waitUntilVisible(search.locationSuggestions);
		await waitUntilVisible(search.locationSuggestion(0));

		await search.selectLocationSuggestion(0);

		// 候補パネルは選択と同時に畳まれる（`handleSuggestionPress` の `setShowSuggestions(false)`）。
		// #528 の再発時はそもそも onPress が走らないため、ここが最初に赤くなる
		await waitUntilGone(search.locationSuggestions);

		// クリアボタンは「入力が 1 文字以上ある」ときだけ描画される。
		// 選択後も残っている ＝ 入力欄が空に戻っていない（既存 spec と同じ、値に依存しない観測点）
		await expect(element(search.locationClearButton)).toExist();

		// 補助的な確認。値そのものは比較せず「何も入っていない」だけを弾く（プラットフォーム差を踏まないため）
		const inputText = await search.readLocationInputText();
		assert.notEqual(
			inputText,
			"",
			"候補をタップしたのに場所入力欄が空です（選択が成立していない可能性。#528 の再発を疑うこと）",
		);

		// ここからが主観測点。地点が確定していなければ handleSearch のバリデーションが
		// global-snackbar を出して遷移をガードするため、トピック画面へは進めない
		await search.submit();

		// トピック生成（AI）の完了は待たない。遷移したことだけをヘッダで確認する。
		// 地点が確定していなければここへ到達できず、25 秒待って落ちる
		await dishCategories.expectHeaderVisible();
		// 遷移を確認したうえで、バリデーション通知が出ていないことも押さえる。
		// 「遷移はしたがスナックバーも出ている」という中途半端な壊れ方を見逃さないため。
		// ⚠️ Detox の `not.toBeVisible()` ではなく `visibleNow` で見る。スナックバーは非表示のとき
		// **要素ごと描画されない**（react-native-paper の Snackbar）ため、「見えない」と
		// 「存在しない」が混ざる。`visibleNow` はどちらも false に潰してくれる
		const snackbarShown = await visibleNow(search.snackbar, 1_000);
		assert.equal(snackbarShown, false, "地点を選択して検索したのにバリデーション通知が表示されている");
	});

	// ─ テストケース: 候補パネルを開いたままキーボードを閉じても、そのあと候補を選択できる ─
	// #528 の本質は「キーボードが閉じることで起きるレイアウト再計算が、進行中のタップを潰す」ことだった。
	// そこでキーボードの開閉を明示的に挟んでから候補を押し、選択が成立することを検証する。
	//
	// ⚠️ 「キーボードが閉じたこと」自体は検証していない。理由は 2 つあり、どちらもこの spec の外側の制約:
	//   - Android の CI/ローカルセットアップは **IME を 1 つも残さず無効化する**
	//     （scripts/setup-android-locale.sh。日本語 IME の初回セットアップダイアログが画面を覆うため）。
	//     つまり Android ではそもそもソフトウェアキーボードが出ない
	//   - Detox にキーボードの可視状態を読む API が無く、iOS でも「閉じたこと」を直接は言えない
	// そのため観測できるのは **「キーボード都合の操作を挟んでも、候補のタップが潰れない」** という結果になる。
	//
	// ## 「背景タップでキーボードを閉じる」経路を検証していない理由（#1369 で前提が変わった）
	// #528 の修正対象だった `useBlurModal` の背景タップ（`handleBackdropPress`）は、
	// 地点オートコンプリートを **BlurModal の中に置いている画面**でしか触れない。
	// 該当していたのはマイページの「保存した料理カテゴリ」→ 地点検索モーダルだけだったが、
	// **#1369 でその画面はルート（`/[locale]/profile/saved-dish-category-location`）になり、
	// BlurModal ごと無くなった**。つまりアプリ内に「背景タップで閉じるオーバーレイの中の
	// オートコンプリート」はもう 1 つも存在せず、検証する経路自体が消えている。
	//
	// 消えたのは «背景タップ» という閉じ方だけで、#528 の本体（候補を押したら地点が本当に
	// 確定するか）は元の当事者の画面で守る。`tests/profile/saved-dish-category-location-search.test.ts` の
	// 「候補をタップすると地点が確定し、検索結果画面へ進む」がそれで、当時ここに書いていた
	// 「保存カテゴリがシードされていない / グリッド項目に testID が無い」という障害は
	// `utils/savedDishCategory.ts` と `save-dish-category-tab-item-<n>` の追加で解消済み。
	// この spec（検索タブ）は、器に依らない «キーボード都合の操作を挟んでもタップが潰れない»
	// 側を引き続き守る。検索タブ側は `keyboardShouldPersistTaps="always"`
	//（search/index.tsx の ScrollView）なので、背景タップでは候補もキーボードも閉じない
	// ＝ 同じ検証をここへ寄せることはできない。
	it("キーボードを閉じる操作を挟んでも候補のタップが潰れない", async () => {
		await search.clearLocationIfPresent();

		await search.typeLocation("渋谷");
		await waitUntilVisible(search.locationSuggestions);
		await waitUntilVisible(search.locationSuggestion(0));

		// リターンキーでキーボードを閉じる（ベストエフォート。IME 無効の Android では何も起きない）。
		// #528 の事故はこの「閉じる」に伴うレイアウト再計算で起きていた
		await search.dismissKeyboardIfOpen();

		// 入力欄をタップし直して候補パネルを開いた状態へ戻す。
		//
		// ⚠️ ここは「キーボードを閉じたら候補が畳まれる / 畳まれない」を主張しない。
		// リターンキーで入力欄が blur すると 150ms 後にパネルを畳む予約が入る
		//（`BLUR_SUGGESTION_HIDE_DELAY_MS`）が、IME を無効化した Android では
		// そもそも blur が起きないため、閉じたかどうかはプラットフォーム依存になる。
		// **条件分岐せず必ずタップし直す**ことで、どちらの経路でも同じ状態から次へ進める:
		// - blur 済みなら再フォーカスで `handleFocus` が畳む予約をキャンセルしてパネルを開き直す
		// - フォーカスが残っているなら onFocus は再発火せず、パネルもそのまま
		// この spec が見たいのは閉じ方ではなく、**そのあとのタップが成立するか**である
		await search.focusLocationInput();
		await waitUntilVisible(search.locationSuggestions);
		await waitUntilVisible(search.locationSuggestion(0));

		await search.selectLocationSuggestion(0);

		// 選択が成立していれば候補パネルは畳まれ、入力は空に戻らない
		await waitUntilNotVisible(search.locationSuggestions);
		await expect(element(search.locationClearButton)).toExist();

		const inputText = await search.readLocationInputText();
		assert.notEqual(
			inputText,
			"",
			"キーボードを閉じたあとに候補をタップしたところ、場所入力欄が空でした（#528 の再発を疑うこと）",
		);
	});
});
