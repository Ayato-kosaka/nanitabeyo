import { launchAppWithSession, localeDeepLink, waitUntilVisible } from "../../fixtures/e2e";
import { DishCategoryGroupVoteResultScreen } from "../../screens/DishCategoryGroupVoteResultScreen";
import { ResultScreen } from "../../screens/ResultScreen";

/**
 * 🗳 友達投票の結果画面 →「店を見る」導線（#1122 の回帰テスト / ネイティブ）
 *
 * 目的: 候補詳細モーダル（`useBlurModal` = react-native-paper の `Portal`）を開いたまま
 *       DishMediaMap へ遷移すると、遷移先の上にバックドロップが残って**一切タップできない**
 *       という #1122 の不具合が、Android で再発していないことを保証する。
 *       修正は PR #1158（モーダルのクローズ完了を待ってから遷移する）。
 *       対応する e2e-web: e2e-web/tests/search/dish-category-group-vote-navigation.spec.ts
 *
 * ## e2e-web から落とした検証（意図的な差分）
 * - **「検索中にモーダルを閉じる → 別候補を開閉 → 無関係な店へ飛ばない」は対象外**。
 *   このシナリオは「未検索候補の dish-media 検索が完了する前にユーザーが操作する」という
 *   タイミングの作り込みが要で、web では `page.route()` で検索 API を保留して再現している。
 *   Detox にはネイティブアプリのリクエストを保留する手段が無く、実 API の応答時間に賭ける
 *   テストはフレークにしかならないため、この回帰は **web 側 1 本で担保する**（同一のロジックが
 *   共通コンポーネントに入っており、プラットフォーム差の無い部分）。
 * - iOS は #1122 の再現対象外（遷移先が `presentation: "transparentModal"` で Portal より上に載る）。
 *   本 spec は Android で回すことに意味がある。
 *
 * ## 実行条件（共有セッションの seed）
 * 結果画面には有効な shareToken が要るが、dev DB に固定の共有セッションを播く仕組みは
 * まだ無い。そのため以下の環境変数が揃っているときだけ実行し、無ければ理由を出して skip する。
 * - `E2E_VOTE_SHARE_TOKEN`: 共有リンクの shareToken
 * - `E2E_VOTE_CANDIDATE_ID`: その中の候補 id（dishMediaSearchStatus が "found" のもの）
 * seed の仕組みが入ったら、この env ガードを seed 呼び出しへ置き換えること。
 */
const SHARE_TOKEN = process.env.E2E_VOTE_SHARE_TOKEN;
const CANDIDATE_ID = process.env.E2E_VOTE_CANDIDATE_ID;

/** 共有セッションの seed が用意されているときだけ実行する describe */
const describeWithVoteSession: typeof describe = (() => {
	if (!SHARE_TOKEN || !CANDIDATE_ID) {
		console.warn(
			"⚠️ E2E_VOTE_SHARE_TOKEN / E2E_VOTE_CANDIDATE_ID が未設定のため、友達投票の遷移 spec を skip します。",
		);
		return describe.skip;
	}
	return describe;
})();

describeWithVoteSession("友達投票の結果画面から店舗画面への遷移 (#1122)", () => {
	const voteResult = new DishCategoryGroupVoteResultScreen();
	const result = new ResultScreen();

	beforeAll(async () => {
		await launchAppWithSession({
			as: "anon",
			url: localeDeepLink(`search/dish-category-group-votes/${SHARE_TOKEN}`),
		});
		await voteResult.expectLoaded(CANDIDATE_ID!);
	});

	// ─ テストケース: モーダルが閉じてから店舗画面へ遷移し、すぐ操作できる ─
	// 手順:
	//   1. 候補カードをタップして詳細モーダルを開く
	//   2. モーダル内の「店を見る」をタップする
	//   3. 詳細モーダル（dish-category-group-vote-candidate-detail）が消えることを検証
	//      = Portal がアンマウント済み。バックドロップが遷移先に残らない
	//   4. 結果画面（result-close-button）が表示されることを検証
	//   5. 閉じるボタンを**実際にタップ**して操作できることを検証
	//      → 修正前はバックドロップが上に残るため、このタップが結果画面へ届かない
	it("モーダルが閉じてから店舗画面へ遷移し、すぐ操作できる", async () => {
		await voteResult.openCandidateDetail(CANDIDATE_ID!);

		await voteResult.pressDetailDishMedia();

		// 「閉じてから遷移」の順序そのもの
		await voteResult.expectDetailClosed();

		await result.expectLoaded();

		// #1122 の本体: 遷移先が「見えている」だけでなく「押せる」こと
		await result.close();
		await waitUntilVisible(voteResult.candidateCard(CANDIDATE_ID!));
	});
});
