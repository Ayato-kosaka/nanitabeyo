import { test, expect } from "../../fixtures/test";
import { PRERENDER_MISS_HYDRATION_NOISE } from "../../utils/consoleNoise";
import {
	GUEST_SUGGESTION_TEST_ID,
	delayOwnProfile,
	hasGuestSuggestionEverAppeared,
	mockVoteDetail,
	voteScreenPath,
	watchGuestSuggestionFlash,
} from "../../utils/dishCategoryGroupVote";

/**
 * 🗳 友達投票の完了モーダル / ログイン済みユーザー（#1120 の回帰テスト）
 *
 * 実行プロジェクト: desktop-chrome-authenticated（storageState 注入済み）
 *
 * ## 何を守るテストか
 * #1120: ログイン済みユーザーが友達投票を完了すると、**一瞬だけゲスト用の絵文字候補**
 * （名前サジェスト）が出てから nickname 初期入力へ差し替わっていた。
 * 修正（PR #1157）は「ログイン状態 + プロフィールが確定するまで、どちらの分岐も描かない」もの。
 * つまり守るべき不変条件は
 *
 *   ログイン済みユーザーには、ゲスト用の絵文字候補が **一度も** 描画されない
 *
 * で、「最終的に出ていない」ではなく「途中でも出ていない」が本質。
 *
 * ## 「一瞬出る」をどう安定して捕まえるか
 * 素の実行だと確定までの窓が数百 ms しかなく、そのままでは観測がフレークする。そこで
 *
 * 1. プロフィール取得 API（`v1/users/:id`）を `page.route()` で **止める**（= 窓を無限に広げる）
 * 2. 窓が開いている間、ゲスト用 UI が出ていないことを検証する
 * 3. MutationObserver の見張り（utils/dishCategoryGroupVote.ts）で
 *    「ポーリングの隙間に出て消えた」パターンも取りこぼさない
 *
 * 回帰すると 1 の遅延中にゲスト用 UI が描かれるため、確実に落ちる。
 *
 * ## dev DB への影響
 * 無し。投票セッションの取得はモックで、投票の送信（POST）までは進めないため
 * 書き込みは一切発生しない（@mutation タグを付けていないのはこのため）。
 */
test.skip(
	() => !process.env.TEST_USER_EMAIL || !process.env.TEST_USER_PASSWORD,
	"TEST_USER_EMAIL / TEST_USER_PASSWORD（e2e-web/.env）が未設定のためスキップ",
);

test.describe("友達投票の完了モーダル（ログイン済みユーザー）", () => {
	test.use({ allowedConsoleErrors: PRERENDER_MISS_HYDRATION_NOISE });

	// ─ テストケース: ログイン状態が確定するまでゲスト用 UI を描かない ─
	// 手順:
	//   1. ゲスト用 UI 出現の見張り（MutationObserver）を仕込む
	//   2. 投票セッション detail をモックし、プロフィール取得 API を止める
	//   3. 投票画面を開き、候補へ 1 回投票して完了モーダルを開く
	//   4. 確定待ちのローディング（dish-category-group-vote-completion-loading）が出ることを検証
	//   5. 窓が開いている間、ゲスト用の絵文字候補が出ていないことを検証（静止確認）
	//   6. プロフィール取得を解放 → 入力フォームへ差し替わることを検証
	//   7. 見張りが「一度も出なかった」と記録していることを検証（本命のアサーション）
	test("ログイン状態が確定するまでゲスト用の絵文字候補を描画しない", async ({ appPage }) => {
		await watchGuestSuggestionFlash(appPage);
		await mockVoteDetail(appPage);
		const releaseProfile = await delayOwnProfile(appPage);

		await appPage.goto(voteScreenPath());

		// 候補は 1 件だけなので、1 回投票すればそのまま完了モーダルが開く
		await appPage.getByTestId("dish-category-group-vote-like-button").click();

		// 確定待ちの間に描かれるのは「ローディング」であって、ゲスト用 UI ではない
		const loading = appPage.getByTestId("dish-category-group-vote-completion-loading");
		await expect(loading).toBeVisible();

		const guestSuggestions = appPage.getByTestId(GUEST_SUGGESTION_TEST_ID);
		await expect(guestSuggestions).toHaveCount(0);

		// 窓を開いたまま少し待ち、「遅れて出てくる」パターンも潰す。
		// （待つ側の理由がある固定 wait なので、ここでは意図的に waitForTimeout を使う）
		await appPage.waitForTimeout(2_000);
		await expect(guestSuggestions).toHaveCount(0);
		await expect(loading).toBeVisible();

		// 確定させると、ゲスト用ではなく通常のフォームへ差し替わる
		releaseProfile();
		await expect(appPage.getByTestId("dish-category-group-vote-completion-form")).toBeVisible();
		await expect(loading).toHaveCount(0);

		// #1120 本命。ここまでの間に一度でも描かれていれば false にならない
		expect(await hasGuestSuggestionEverAppeared(appPage)).toBe(false);
	});

	// ─ テストケース: 確定後もゲスト用 UI は出ない（差し替え後の最終状態） ─
	// 手順:
	//   1. detail をモックし、プロフィール取得は遅延させずに投票画面を開く
	//   2. 1 回投票して完了モーダルを開く
	//   3. 入力フォームが表示され、ゲスト用の絵文字候補が無いことを検証
	//      （ログイン済みユーザーは表示名が初期入力される = サジェストの出番が無い）
	test("確定後もゲスト用の絵文字候補は表示されない", async ({ appPage }) => {
		await watchGuestSuggestionFlash(appPage);
		await mockVoteDetail(appPage);

		await appPage.goto(voteScreenPath());
		await appPage.getByTestId("dish-category-group-vote-like-button").click();

		await expect(appPage.getByTestId("dish-category-group-vote-completion-form")).toBeVisible();
		await expect(appPage.getByTestId(GUEST_SUGGESTION_TEST_ID)).toHaveCount(0);
		expect(await hasGuestSuggestionEverAppeared(appPage)).toBe(false);
	});
});
