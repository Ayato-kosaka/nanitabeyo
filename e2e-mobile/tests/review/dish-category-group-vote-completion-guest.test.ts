import { element, existsNow, expect, launchAppWithSession, localeDeepLink } from "../../fixtures/e2e";
import { DishCategoryGroupVoteScreen } from "../../screens/DishCategoryGroupVoteScreen";

/**
 * 🗳 友達投票の完了モーダル / ゲストユーザー（#1120 の対になるテスト）
 *
 * 対応する e2e-web の spec: tests/dish-category-group-votes/vote-completion-guest.spec.ts
 *
 * ## 何を守るテストか
 * #1120 の修正は「ログイン状態が確定するまでどちらの分岐も描かない」というもので、
 * やり過ぎるとゲストにも絵文字候補が出なくなる（= 名前を自分で考えないと投票を送信できない）
 * という別の劣化になりうる。このテストはその方向の回帰を防ぐ。
 *
 * ゲストは `isGuestUser(user) === true` が確定した時点で分岐でき、プロフィール取得の完了を
 * 待つ必要が無い（参照しないため）。よって完了モーダルが開いた時点で絵文字候補まで描かれるのが正しい。
 *
 * ## 前提データ / スコープ
 * ネイティブは detail API をモックできないため、実在する未投票の shareToken を
 * `TEST_GROUP_VOTE_SHARE_TOKEN` で渡す必要がある（未設定ならスキップ）。
 * 「一瞬だけゲスト用 UI が出る」ことの検知は web 側の spec だけが行う。理由は
 * tests/authenticated/dish-category-group-vote-completion-identity.test.ts の冒頭コメントを参照。
 *
 * ## dev DB への影響
 * 無し（完了モーダルを開くところまでで、送信は行わない）。
 */
const SHARE_TOKEN = process.env.TEST_GROUP_VOTE_SHARE_TOKEN;

const describeWithShareToken = SHARE_TOKEN ? describe : describe.skip;

describeWithShareToken("友達投票の完了モーダル（ゲストユーザー）", () => {
	const voteScreen = new DishCategoryGroupVoteScreen();

	beforeAll(async () => {
		// Node 側で確立済みの匿名セッションを注入して起動する（匿名サインインのクォータを消費しない）
		await launchAppWithSession({
			as: "anon",
			url: localeDeepLink(`search/dish-category-group-votes/${SHARE_TOKEN}/vote`),
		});
	});

	// ─ テストケース: ゲストには絵文字の名前候補が表示される ─
	// 手順:
	//   1. 匿名セッションで投票画面へディープリンクする
	//   2. 全候補へ投票して完了モーダルを開く
	//   3. 確定待ちのローディングが消えてフォームが出るまで待つ
	//   4. ゲスト向けの名前サジェスト（絵文字候補）が表示されることを検証
	it("ゲストユーザーには従来どおり絵文字の名前候補が表示される", async () => {
		await voteScreen.expectVoteCardLoaded();

		for (let i = 0; i < 10; i += 1) {
			if (!(await existsNow(voteScreen.likeButton))) break;
			await element(voteScreen.likeButton).tap();
		}

		await voteScreen.expectCompletionSettled();

		await expect(element(voteScreen.nameSuggestions)).toBeVisible();
	});
});
