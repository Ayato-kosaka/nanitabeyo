import {
	describeAuthenticated,
	element,
	existsNow,
	expect,
	launchAppWithSession,
	localeDeepLink,
} from "../../fixtures/e2e";
import { DishCategoryGroupVoteScreen } from "../../screens/DishCategoryGroupVoteScreen";

/**
 * 🗳 友達投票の完了モーダル / ログイン済みユーザー（#1120 の回帰テスト）
 *
 * 対応する e2e-web の spec:
 * - tests/authenticated/dish-category-group-vote-completion-identity.spec.ts
 * - tests/dish-category-group-votes/vote-completion-guest.spec.ts
 *
 * ## 何を守るテストか
 * #1120: ログイン済みユーザーが友達投票を完了すると、**一瞬だけゲスト用の絵文字候補**
 * （名前サジェスト）が出てから nickname 初期入力へ差し替わっていた。
 * 修正（PR #1157）は「ログイン状態 + プロフィールが確定するまでどちらの分岐も描かない」もの。
 *
 * ## ⚠️ web 側とスコープが違う（重要）
 * 「**一瞬だけ**出る」ことの検知は **web 側の spec だけ** が行っている。
 * web は `page.route()` でプロフィール取得 API を止めて確定待ちの窓を人為的に広げ、
 * さらに MutationObserver で「出て消えた」まで拾えるが、Detox には
 *
 * - ネットワークを差し込む仕組み（`page.route()` 相当）が無い
 *   （このリポジトリの e2e-mobile にもネットワーク制御の仕組みは無い。
 *     セッション注入は `launchArgs` 経由で、HTTP レイヤには介入していない）
 * - DOM の MutationObserver 相当が無く、観測は Detox の matcher によるポーリングだけ
 *
 * ため、数百 ms の窓を安定して観測できない。そこでネイティブ側は
 * **「完了モーダルが開いて安定したあと、ゲスト用 UI が存在しない」** という
 * 弱い（しかし確実に判定できる）不変条件に絞る。
 * 「確定を待たずゲスト用を描いてから差し替える」実装へ戻った場合、最終状態は
 * ログイン済み用に落ち着くためこのテストでは捕まらない。そこは web 側が担保する。
 *
 * ## 前提データ（TEST_GROUP_VOTE_SHARE_TOKEN）
 * ネイティブは detail API をモックできないため、**実在する投票セッション** が要る。
 * `TEST_GROUP_VOTE_SHARE_TOKEN` に、テストユーザーが **まだ投票していない** dev 環境の
 * shareToken を渡すこと（投票済みだと画面が結果画面へ router.replace され、投票カードに
 * 到達できない）。未設定ならスキップする。
 *
 * ## dev DB への影響
 * 無し。完了モーダルを開くところまでで、送信（POST vote）は行わない。
 * 投票の下書きはクライアント側の state にしか無いため、アプリを終了すれば消える。
 */
const SHARE_TOKEN = process.env.TEST_GROUP_VOTE_SHARE_TOKEN;

const describeWithShareToken = SHARE_TOKEN ? describeAuthenticated : describe.skip;

describeWithShareToken("友達投票の完了モーダル（ログイン済みユーザー）", () => {
	const voteScreen = new DishCategoryGroupVoteScreen();

	beforeAll(async () => {
		// ログイン済みセッションを注入して、投票画面へディープリンクで直接入る。
		// （トピック提案 → グループ投票作成 → 共有 の導線を毎回通ると AI 生成待ちで不安定になるため）
		await launchAppWithSession({
			as: "authenticated",
			url: localeDeepLink(`search/dish-category-group-votes/${SHARE_TOKEN}/vote`),
		});
	});

	// ─ テストケース: 完了モーダルにゲスト用の絵文字候補が出ない ─
	// 手順:
	//   1. ログイン済みセッションで投票画面へディープリンクする
	//   2. 全候補へ投票して完了モーダルを開く
	//   3. 確定待ちのローディングが消えてフォームが出る（= 安定した）まで待つ
	//   4. ゲスト用の名前サジェストが存在しないことを検証
	//   5. 表示名がログインユーザーの display_name で初期入力されていることを検証
	//      （「サジェストが無い」だけだと、単に描画が壊れていても通ってしまうため）
	it("完了モーダルにゲスト用の絵文字候補が表示されない", async () => {
		await voteScreen.expectVoteCardLoaded();

		// 候補数は dev 環境のセッション次第なので、投票カードが消える（= 完了モーダルが開く）まで
		// 「良い」を押し続ける。候補数の上限（app-expo 側は最大 10 件）を超えないよう回数で打ち切る
		for (let i = 0; i < 10; i += 1) {
			if (!(await existsNow(voteScreen.likeButton))) break;
			await element(voteScreen.likeButton).tap();
		}

		await voteScreen.expectCompletionSettled();

		// #1120 の本体: ログイン済みユーザーにゲスト用 UI は出ない
		await expect(element(voteScreen.nameSuggestions)).not.toExist();

		// 「サジェストが出ない」の裏返しとして、ログイン済み用の初期入力が効いていること。
		// display_name はテストユーザー依存なので値は問わず「空でないこと」だけを見る
		await expect(element(voteScreen.displayNameInput)).not.toHaveText("");
	});
});
