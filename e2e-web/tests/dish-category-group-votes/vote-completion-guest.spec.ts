import { test, expect } from "../../fixtures/test";
import { PRERENDER_MISS_HYDRATION_NOISE } from "../../utils/consoleNoise";
import { GUEST_SUGGESTION_TEST_ID, mockVoteDetail, voteScreenPath } from "../../utils/dishCategoryGroupVote";

/**
 * 🗳 友達投票の完了モーダル / ゲストユーザー（#1120 の対になるテスト）
 *
 * 実行プロジェクト: desktop-chrome（匿名 storageState）
 *
 * ## 何を守るテストか
 * #1120 の修正は「ログイン状態が確定するまでどちらの分岐も描かない」というもので、
 * やり過ぎるとゲストユーザーにも絵文字候補が出なくなる（= 名前を自分で考えないと
 * 投票を送信できない）という別の劣化になりうる。
 * このテストは **ゲストには従来どおり絵文字候補が出る** ことを固定して、その方向の回帰を防ぐ。
 *
 * ゲストは `isGuestUser(user) === true` が確定した時点で分岐でき、プロフィール取得を
 * 待つ必要が無い（参照しないため）。したがってログイン済み側と違い、完了モーダルが
 * 開いた時点で絵文字候補まで描かれるのが正しい挙動。
 *
 * ## dev DB への影響
 * 無し（detail はモック、投票の送信までは進めない）。詳細は utils/dishCategoryGroupVote.ts を参照。
 */
test.describe("友達投票の完了モーダル（ゲストユーザー）", () => {
	test.use({ allowedConsoleErrors: PRERENDER_MISS_HYDRATION_NOISE });

	// ─ テストケース: ゲストには絵文字候補が表示される ─
	// 手順:
	//   1. 投票セッション detail をモックして投票画面を開く
	//   2. 候補へ 1 回投票して完了モーダルを開く
	//   3. 入力フォームと、ゲスト向けの名前サジェスト（絵文字候補）が表示されることを検証
	//   4. サジェストを 1 つタップすると表示名入力へ反映されることを検証
	test("ゲストユーザーには従来どおり絵文字の名前候補が表示される", async ({ appPage }) => {
		await mockVoteDetail(appPage);

		await appPage.goto(voteScreenPath());

		// 候補は 1 件だけなので、1 回投票すればそのまま完了モーダルが開く
		await appPage.getByTestId("dish-category-group-vote-like-button").click();

		await expect(appPage.getByTestId("dish-category-group-vote-completion-form")).toBeVisible();

		const guestSuggestions = appPage.getByTestId(GUEST_SUGGESTION_TEST_ID);
		await expect(guestSuggestions).toBeVisible();

		// ゲストは display_name を持たないので、確定待ちのローディングで止まらないこと
		await expect(appPage.getByTestId("dish-category-group-vote-completion-loading")).toHaveCount(0);

		// 候補は「選べば表示名になる」ことまで確認する（表示だけして機能していない状態を弾く）
		const nameInput = appPage.getByTestId("dish-category-group-vote-display-name-input");
		const firstSuggestion = guestSuggestions.getByRole("button").first();
		const suggestionText = (await firstSuggestion.innerText()).trim();
		await firstSuggestion.click();
		await expect(nameInput).toHaveValue(suggestionText);
	});
});
