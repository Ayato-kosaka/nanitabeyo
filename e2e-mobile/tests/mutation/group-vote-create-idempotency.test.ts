import { describeMutation, device, launchAppWithSession, waitUntilVisible } from "../../fixtures/e2e";
import { DishCategoryGroupVoteResultScreen } from "../../screens/DishCategoryGroupVoteResultScreen";
import { SearchScreen } from "../../screens/SearchScreen";
import { DishCategoriesScreen } from "../../screens/DishCategoriesScreen";

/**
 * 🔁 友達投票の作成が再送に対して冪等であること @mutation（#1507 / GRP-14）
 *
 * e2e-web の tests/dish-category-group-votes/create-idempotency.spec.ts に対応する。
 *
 * ## 何を守っているか（#1507）
 * `POST v1/dish-category-group-votes` の再送で、**別々の shareToken を持つ投票セッションが
 * 2 件作られる**事故を防ぐ。2 件できると、片方のリンクを配った参加者と、もう片方を見ている
 * ホストが別の投票を見ることになり、集計が合わない。
 * #1205 の `isCreatingRef` は「同一 JS タスク内の連打」しか守れない
 *（それは dishCategories-group-vote-double-tap.test.ts が担保している）。#1507 では
 * body の `idempotencyKey` を使ったサーバー側の冪等化を入れ、クライアントは
 * **同じ作成意図のあいだ同じキーを送り続ける**ようにした。
 *
 * ## e2e-web から落とした検証（意図的な差分）
 * Detox には `page.route()` に相当するネットワーク傍受 API が無いため、次の 2 つは
 * **web 側でしか担保できない**（review-submit-loading.test.ts / dishCategories-group-vote-double-tap.test.ts と
 * 同じ位置づけ）。
 *
 * - **再送の `idempotencyKey` が 1 発目と同じであること**: リクエスト body を読めない
 * - **2 発目のレスポンスの shareToken が 1 発目と同じであること**（= セッションが 1 件しか無い）:
 *   レスポンスを読めないうえ、そもそも **「サーバーには届いたが応答だけが失われた」状況を
 *   ネイティブでは作れない**。`device.setURLBlacklist` はリクエスト自体を止めてしまうので、
 *   サーバーには何も届かず、冪等化が働く前提が成立しない
 *
 * ## だからネイティブ側で見るもの
 * ユーザーから見える事実、すなわち **「通信に失敗したあと、もう一度押せば投票結果画面が
 * ちょうど 1 枚だけ開く」** ことを見る。冪等キーは「作成意図につき 1 回だけ生成し、
 * 失敗しても捨てない」という寿命を持つので、この解除まわりを壊すと
 *（例: 失敗時にキーを握ったまま `isCreatingRef` を落とし忘れる、成功時にキーを捨て忘れる）
 * ここが赤くなる。
 *
 * ## dev DB への影響（重要）
 * 2 回目の作成は実際に成功するため、この spec は **不可逆**（dev DB に投票セッションが
 * 1 件積み上がる。削除導線は無い）。1 回目は blacklist でサーバーへ届かないので増えない。
 * 作成リクエストの中身は検索結果の候補スナップショットで、`[E2E]` のような目印を混ぜられない
 *（dishCategories-group-vote-double-tap.test.ts と同じ制約）。
 * `RUN_MUTATION=1` を明示した手動実行でのみ走らせること。
 *
 * ## ⚠️ migration 未適用のあいだは実行しないこと
 * #1507 の migration（`idempotency_key` 列 + `(host_user_id, idempotency_key)` の複合 UNIQUE）が
 * dev へ適用されるまで、`idempotencyKey` を載せた作成リクエストはサーバー側で失敗する。
 * 適用後に実行すること。
 */
describeMutation("友達投票作成の再送耐性 @mutation", () => {
	const search = new SearchScreen();
	const dishCategories = new DishCategoriesScreen();
	const voteResult = new DishCategoryGroupVoteResultScreen();

	/** 作成 API を止めるための blacklist パターン（Detox は正規表現の文字列を受け取る） */
	const CREATE_URL_PATTERN = ".*dish-category-group-votes.*";

	/** 投票セッションの作成 + detail 取得を挟むため、カード表示より更に余裕を取る */
	const VOTE_RESULT_TIMEOUT = 60_000;

	// #1027 テストごとに起動し直して独立性を担保する
	// #1030 3-1 セッション注入起動は匿名クォータを消費しない
	beforeEach(async () => {
		await launchAppWithSession({ as: "anon" });
		await search.expectLoaded();
	});

	// blacklist は «実行中のアプリへの invoke» なので、テストが失敗しても次のテストへ漏らさないよう
	// 必ず戻す（残ると以降の spec で全 API が黙って落ちる）
	afterEach(async () => {
		await device.setURLBlacklist([]);
	});

	// ─ テストケース: 作成に失敗したあと押し直すと、結果画面が 1 枚だけ開く ─
	// 手順:
	//   1. 場所に「渋谷」を入力しサジェスト先頭を選択する
	//   2. 検索してトピック提案画面まで進む（スポットライトは expectLoaded が閉じる）
	//   3. 作成 API を blacklist で止め、「友達投票開始」を押す
	//      → 失敗してトピック画面に留まる（= 結果画面は開かない）
	//   4. blacklist を解除して、もう一度「友達投票開始」を押す
	//      → ここで初めてサーバーへ届き、**同じ冪等キー**で作成される
	//   5. 投票結果画面が **ちょうど 1 枚** 開くことを検証
	//      = `dish-category-group-vote-copy-share-link` を添字なしで解決する。二重 push なら
	//        2 件一致して Detox が「Multiple elements were matched」で落ちる
	//        （expectSingleLoaded の JSDoc 参照）
	it("作成に失敗したあと押し直すと、投票結果画面が 1 枚だけ開く", async () => {
		await search.typeLocation("渋谷");
		await search.selectLocationSuggestion(0);
		await search.submit();
		await dishCategories.expectLoaded();

		// ─ 1 発目: 通信を止めて失敗させる ─
		await device.setURLBlacklist([CREATE_URL_PATTERN]);
		await dishCategories.openGroupVote();

		// 失敗しても «押せる状態» のトピック画面に留まること。
		// #1205 のガード解除（hook の finally と dishCategories.tsx の catch）が壊れると、ここから先へ進めなくなる
		await dishCategories.expectHeaderVisible();
		await waitUntilVisible(dishCategories.groupVoteButton);

		// ─ 2 発目: 通信を戻して押し直す ─
		await device.setURLBlacklist([]);
		await dishCategories.openGroupVote();

		await voteResult.expectSingleLoaded(VOTE_RESULT_TIMEOUT);

		// 戻って再操作できること（作成済みレスポンスのキャッシュ経路も同時に通る）
		await voteResult.goBack();
		await dishCategories.expectHeaderVisible();
	});
});
