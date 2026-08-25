import { describeMutation, launchAppWithSession } from "../../fixtures/e2e";
import { DishCategoryGroupVoteResultScreen } from "../../screens/DishCategoryGroupVoteResultScreen";
import { SearchScreen } from "../../screens/SearchScreen";
import { DishCategoriesScreen } from "../../screens/DishCategoriesScreen";

/**
 * 👆👆 友達投票開始ボタンの連打耐性テスト @mutation（#1205 / 親 #1194）
 *
 * e2e-web の tests/search/dish-categories-group-vote-double-tap.spec.ts に対応する。
 *
 * ## 何を守っているか（#1205）
 * トピック提案画面のヘッダー「友達投票開始」ボタンのガードは元々 `isCreating`(useState) だけだった。
 * React が再レンダリングをコミットする前に 2 発目の押下が処理されると両方が
 * `isCreating === false` を読んで通過しうるため、`POST v1/dish-category-group-votes` が二重に走る。
 * API は呼び出しごとに新しい `shareToken` を発行し冪等化していないので、
 * **別々の投票セッションが 2 件でき、結果画面も 2 枚積まれる**。
 * #1205 で `useCreateDishCategoryGroupVote` の `isCreatingRef` と、dishCategories 画面の
 * `isOpeningGroupVoteRef` による同期ガードを追加した
 *（`search/index.tsx` の `isSearchingRef` / `map/components/ReviewForm.tsx` の `isSubmittingRef` と同じ方式）。
 *
 * ## 連打の再現方法（#1084 設計 §3-2）
 * `openGroupVote()` の連続呼び出しは **連打にならない**。Android は Detox の同期機構が有効なため、
 * 1 発目のあと「遷移アニメーション + 作成 API の完了」まで待ってから 2 発目が飛び、
 * 連打事故が起きる脆弱な窓を確実に外してしまう（= 事故があっても緑になる偽陰性）。
 * n 回のタップを 1 アクションとして送る `multiTap` を使う（`DishCategoriesScreen.openGroupVoteRapid`）。
 *
 * ## e2e-web から落とした検証（意図的な差分）
 * - **作成 API の呼び出し回数**: Detox には `page.route()` に相当するネットワーク傍受 API が無いため
 *   「POST が 1 回だけ」は検証できない。**web 側で担保する**
 *   （review-submit-loading.test.ts が「失敗時の解除」を web 側だけで担保しているのと同じ位置づけ）。
 *   native 側は「結果画面が 1 枚だけ」「戻ってから再操作できる」というユーザーから見える事実を見る
 * - **戻った後の再押下で API が増えないこと**（キャッシュ再利用）も回数の話なので web 側だけ
 *
 * ## dev DB への影響（重要）
 * ネットワークを止められない = 作成は最後まで実際に走るため、この spec は **不可逆**
 *（dev DB に投票セッションが 1 件積み上がる。削除導線は無い）。事故が起きている場合は 2 件以上になる。
 * 作成リクエストの中身は検索結果の候補スナップショットで自由入力欄が無く、`[E2E]` のような
 * 目印を混ぜられない（tests/mutation/review-post.test.ts との差分）。
 * `RUN_MUTATION=1` を明示した手動実行でのみ走らせること（jest.config.js の testPathIgnorePatterns +
 * describeMutation の二重ガード）。
 */
describeMutation("友達投票開始ボタンの連打耐性 @mutation", () => {
	const search = new SearchScreen();
	const dishCategories = new DishCategoriesScreen();
	const voteResult = new DishCategoryGroupVoteResultScreen();

	/**
	 * 連打回数。
	 *
	 * ⚠️ 3 回以上にしないこと（search-double-tap.test.ts と同じ理由）。`multiTap` は同じ座標へ
	 * 打ち続けるため、遷移後は結果画面のヘッダー領域を叩いてしまう。
	 * 2 発でも「React のコミット前に 2 発目が届く」窓は再現できる（#1084 で実測）。
	 */
	const PRESS_COUNT = 2;

	/** 投票セッションの作成 + detail 取得を挟むため、カード表示より更に余裕を取る */
	const VOTE_RESULT_TIMEOUT = 60_000;

	// #1027 テストごとに起動し直して独立性を担保する
	// #1030 3-1 セッション注入起動は匿名クォータを消費しない
	beforeEach(async () => {
		await launchAppWithSession({ as: "anon" });
		await search.expectLoaded();
	});

	// ─ テストケース: 連打しても投票結果画面は 1 枚しか開かず、戻れば再操作できる ─
	// 手順:
	//   1. 場所に「渋谷」を入力しサジェスト先頭を選択する（時間帯・同行者は初期値があるため不要）
	//   2. 検索してトピック提案画面まで進む（スポットライトは expectLoaded が閉じる）
	//   3. ヘッダーの「友達投票開始」を 2 連打する
	//   4. 投票結果画面が **ちょうど 1 枚** 開くことを検証
	//      = `dish-category-group-vote-copy-share-link` を添字なしで解決する。二重 push なら
	//        2 件一致して Detox が「Multiple elements were matched」で落ちる
	//        （expectSingleLoaded の JSDoc 参照）
	//   5. **1 回だけ**戻り、トピック画面に着くことを検証（二重に積まれていれば結果画面に留まる）
	//   6. もう一度「友達投票開始」を押し、結果画面がまた開くことを検証
	//      = 受け入れ条件「結果画面から戻った後、必要な操作が正常に行える」。
	//        ガードの解除は dishCategories.tsx の useFocusEffect が握っており、解除を消すとここで
	//        二度と進めなくなって赤くなる（作成済みレスポンスのキャッシュ経路も同時に通る）
	it("友達投票開始ボタンを連打しても投票結果画面は 1 枚しか開かない", async () => {
		await search.typeLocation("渋谷");
		await search.selectLocationSuggestion(0);
		await search.submit();
		await dishCategories.expectLoaded();

		await dishCategories.openGroupVoteRapid(PRESS_COUNT);

		await voteResult.expectSingleLoaded(VOTE_RESULT_TIMEOUT);

		await voteResult.goBack();
		await dishCategories.expectHeaderVisible();

		await dishCategories.openGroupVote();
		await voteResult.expectSingleLoaded(VOTE_RESULT_TIMEOUT);
	});
});
