import type { Page, Route } from "@playwright/test";
import { test, expect } from "../../fixtures/test";
import { MyDishCategoryGroupVotesPage } from "../../pages/MyDishCategoryGroupVotesPage";
import { mockVoteDetail, MOCK_SHARE_TOKEN } from "../../utils/dishCategoryGroupVote";
import type { MeDishCategoryGroupVoteListItem, QueryMeDishCategoryGroupVotesResponse } from "@shared/api/v1/res";

/**
 * 🗳 「グループ投票の履歴」一覧画面 (#1505)
 *
 * ## 背景
 * #1505 で追加された新規画面（app-expo/app/[locale]/(tabs)/profile/dish-category-group-votes.tsx）。
 * 一覧に出るのは **自分が主催した投票だけ**（参加しただけの投票は出さない）。
 * 一覧の取得元は実アカウントの投票履歴に依存し、0 件・複数件を実データで確実に用意することは
 * できないため、`GET /v1/users/me/dish-category-group-votes` を `page.route()` で固定レスポンスに
 * 差し替える。
 *
 * ## 「参加しただけの投票を出さない」の担保場所
 * この絞り込みは API の where 句（`host_user_id = 自分`）で行っており、ここで一覧 API を
 * モックしている以上 web からは検証できない。除外そのものは
 * `api/src/v1/dish-category-group-votes/dish-category-group-votes.repository.spec.ts` が固定する。
 *
 * ## この spec が守るもの（#1505 デザイン再設計）
 * 行の主役は «候補の写真と料理名» である。ここが消えると、行は再設計前の
 * 「日付 · 候補 N 件」に逆戻りする（オーナー指摘の「不格好」の原因そのもの）。
 * 見た目の美しさは spec では測れないが、**行が «何を投票したのか» を語っているか**は
 * 検証できるので、そこを固定する。
 *
 * - 勝者が決まった投票の行は、勝者の料理名を出す
 * - 決まっていない投票の行は、候補名の要約（「ラーメン・寿司ほか2件」）を出す
 * - 状態はテキストバッジではなく、未投票のドットと読み上げ名で伝える
 * - 空状態は文字 1 行ではなく、説明と «投票を作る» 導線を持つ
 *
 * 投票結果画面への遷移確認は、既存の `utils/dishCategoryGroupVote.ts`（#1120 の spec 用に作られた
 * detail API のモック）をそのまま再利用する。`MOCK_SHARE_TOKEN` を一覧アイテムの shareToken に
 * 合わせれば、タップ後の遷移先（`[shareToken]` 結果画面）もモックだけで到達できる。
 */

/** GET /v1/users/me/dish-category-group-votes のパス（cursor 等のクエリを許容） */
const LIST_URL_PATTERN = /\/v1\/users\/me\/dish-category-group-votes(\?.*)?$/;

/** `callBackend` が要求する BaseResponse の封筒 `{ success, data }` で応答する */
async function fulfillJson(route: Route, data: unknown): Promise<void> {
	// バックエンドは別オリジン(Cloud Run)。`fetchWithAuth` は web で credentials:"include" を使うため
	// `access-control-allow-origin: "*"` は使えず、リクエスト元 origin をそのまま返す
	// (utils/network.ts の stubSavedDishCategories と同じ理由)
	const origin = (await route.request().headerValue("origin")) ?? "*";
	await route.fulfill({
		status: 200,
		contentType: "application/json",
		headers: {
			"access-control-allow-origin": origin,
			"access-control-allow-credentials": "true",
		},
		body: JSON.stringify({ success: true, data }),
	});
}

/** 一覧 API を固定アイテムへ差し替える（`page.goto` より前に呼ぶこと） */
async function mockMeDishCategoryGroupVotes(page: Page, items: MeDishCategoryGroupVoteListItem[]): Promise<void> {
	const response: QueryMeDishCategoryGroupVotesResponse = { data: items, nextCursor: null };
	await page.route(LIST_URL_PATTERN, async (route) => {
		await fulfillJson(route, response);
	});
}

/** 候補プレビュー。画像は読めなくてよい（読めなくても行が崩れないことがこの画面の要件） */
function preview(displayName: string): MeDishCategoryGroupVoteListItem["candidatePreviews"][number] {
	return { displayName, imageUrl: `https://img.example.invalid/${encodeURIComponent(displayName)}.jpg` };
}

function buildItem(overrides: Partial<MeDishCategoryGroupVoteListItem>): MeDishCategoryGroupVoteListItem {
	return {
		id: "e2e-1505-item",
		shareToken: "e2e-1505-share-token",
		hasVoted: false,
		candidateCount: 3,
		candidatePreviews: [preview("ラーメン"), preview("寿司"), preview("カレー")],
		participantCount: 0,
		winnerName: null,
		createdAt: "2026-08-10T00:00:00.000Z",
		updatedAt: "2026-08-10T00:00:00.000Z",
		...overrides,
	};
}

test.describe("グループ投票の履歴一覧 (#1505)", () => {
	// ─ テストケース: 一覧が表示される ─
	test("一覧が表示される", async ({ appPage }) => {
		const item = buildItem({ id: "e2e-1505-list", shareToken: "e2e-1505-share-list" });
		await mockMeDishCategoryGroupVotes(appPage, [item]);

		const listPage = new MyDishCategoryGroupVotesPage(appPage);
		await listPage.goto();
		await listPage.expectLoaded();

		await expect(listPage.item(0)).toBeVisible();
	});

	// ─ テストケース: 0 件のときは空表示が出る ─
	// #1505 空状態は文字 1 行だけだったものを、説明と CTA を持つ形へ作り直した。
	// 「なぜ空か + 次に何をすればよいか」を言うのは docs/design-guidelines.md §4 の要件。
	test("0件のときは空状態が説明と導線つきで表示される", async ({ appPage }) => {
		await mockMeDishCategoryGroupVotes(appPage, []);

		const listPage = new MyDishCategoryGroupVotesPage(appPage);
		await listPage.goto();
		await listPage.expectLoaded();
		await listPage.expectEmpty();

		await expect(listPage.emptyState).toContainText("まだ主催したグループ投票がありません");
		await expect(listPage.emptyState).toContainText("料理を検索して候補を出すと");
		await expect(listPage.emptyAction).toBeVisible();
	});

	// ─ テストケース: 空状態の CTA から投票を作れる場所（検索タブ）へ行ける ─
	// 「案内文が指す導線がその画面から実際に辿れる」ことを確かめる（design-guidelines §4）。
	test("空状態の「投票を作る」から検索タブへ遷移する", async ({ appPage }) => {
		await mockMeDishCategoryGroupVotes(appPage, []);

		const listPage = new MyDishCategoryGroupVotesPage(appPage);
		await listPage.goto();
		await listPage.expectLoaded();
		await listPage.expectEmpty();

		await listPage.emptyAction.click();

		await expect(appPage).toHaveURL(/\/ja-JP\/search(\?.*)?$/);
	});

	// ─ テストケース: 一覧から投票へ遷移できる ─
	// タップした行の shareToken を持つ投票結果画面（[shareToken] ルート）へ遷移し、
	// ヘッダーの「共有リンクをコピー」(dish-category-group-vote-copy-share-link) が
	// 表示されることで到達を確認する。detail API は #1120 用の既存モックをそのまま使う。
	test("一覧から投票（結果画面）へ遷移できる", async ({ appPage }) => {
		const item = buildItem({ id: "e2e-1505-nav", shareToken: MOCK_SHARE_TOKEN, candidateCount: 1 });
		await mockMeDishCategoryGroupVotes(appPage, [item]);
		await mockVoteDetail(appPage);

		const listPage = new MyDishCategoryGroupVotesPage(appPage);
		await listPage.goto();
		await listPage.expectLoaded();

		await listPage.openItem(0);

		await expect(appPage).toHaveURL(new RegExp(`/search/dish-category-group-votes/${MOCK_SHARE_TOKEN}`));
		await expect(appPage.getByTestId("dish-category-group-vote-copy-share-link")).toBeVisible();
	});

	// ─ テストケース: 行が «何を投票したのか» を語る（#1505 デザイン再設計の核心） ─
	// 勝者が決まっていればその料理名、決まっていなければ候補名の要約。
	// 「候補 3 件」のような、何の料理か分からない表示へ戻ったらここが赤くなる。
	test("行は勝者の料理名（未決なら候補名の要約）と参加人数を出す", async ({ appPage }) => {
		const decided = buildItem({
			id: "e2e-1505-decided",
			shareToken: "e2e-1505-share-decided",
			hasVoted: true,
			candidateCount: 3,
			candidatePreviews: [preview("ラーメン"), preview("寿司"), preview("カレー")],
			participantCount: 5,
			winnerName: "ラーメン",
			updatedAt: "2026-08-10T00:00:00.000Z",
		});
		const undecided = buildItem({
			id: "e2e-1505-undecided",
			shareToken: "e2e-1505-share-undecided",
			hasVoted: false,
			// 候補 5 件のうちプレビューは 3 件 ＝ 要約は「ほか2件」になる
			candidateCount: 5,
			candidatePreviews: [preview("うどん"), preview("そば"), preview("天ぷら")],
			participantCount: 2,
			winnerName: null,
			updatedAt: "2026-08-05T00:00:00.000Z",
		});
		await mockMeDishCategoryGroupVotes(appPage, [decided, undecided]);

		const listPage = new MyDishCategoryGroupVotesPage(appPage);
		await listPage.goto();
		await listPage.expectLoaded();

		// 決まっている投票 ＝ 勝者の料理名がそのまま行の見出しになる
		await expect(listPage.itemTitle(0)).toHaveText("ラーメン");
		await expect(listPage.item(0)).toContainText("5人が投票");

		// 決まっていない投票 ＝ 候補名を連ねた要約。4 件目以降は「ほか N 件」に畳む
		await expect(listPage.itemTitle(1)).toHaveText("うどん・そば・天ぷら ほか2件");
		await expect(listPage.item(1)).toContainText("2人が投票");

		// 再設計前の「候補 N 件」表示へ戻っていないこと
		await expect(appPage.getByText(/候補 \d+ 件/)).toHaveCount(0);
	});

	// ─ テストケース: 状態はテキストバッジではなくドットと読み上げ名で伝える ─
	test("未投票の行にだけドットが出て、状態は読み上げ名に入る", async ({ appPage }) => {
		const notVoted = buildItem({
			id: "e2e-1505-not-voted",
			shareToken: "e2e-1505-share-not-voted",
			hasVoted: false,
			winnerName: null,
			participantCount: 1,
			updatedAt: "2026-08-10T00:00:00.000Z",
		});
		const voted = buildItem({
			id: "e2e-1505-voted",
			shareToken: "e2e-1505-share-voted",
			hasVoted: true,
			winnerName: "カレー",
			participantCount: 4,
			updatedAt: "2026-08-05T00:00:00.000Z",
		});
		await mockMeDishCategoryGroupVotes(appPage, [notVoted, voted]);

		const listPage = new MyDishCategoryGroupVotesPage(appPage);
		await listPage.goto();
		await listPage.expectLoaded();

		// ドットは未投票の行にだけ出る
		await expect(listPage.unvotedDot(listPage.item(0))).toBeVisible();
		await expect(listPage.unvotedDot(listPage.item(1))).toHaveCount(0);

		// 目に見えるテキストバッジは廃止した（行の中に「未投票」「投票済み」の文字は無い）
		await expect(listPage.item(0).getByText("未投票", { exact: true })).toHaveCount(0);
		await expect(listPage.item(1).getByText("投票済み", { exact: true })).toHaveCount(0);

		// 「いつ・何の投票・状態」は読み上げ名（aria-label）が持つ
		await listPage.expectAccessibleName(listPage.item(0), /2026.*グループ投票.*1人が投票.*未投票/s);
		await listPage.expectAccessibleName(listPage.item(1), /2026.*決定: カレー.*4人が投票.*投票済み/s);

		// 全行が主催なので「主催」バッジは画面のどこにも無い
		await expect(appPage.getByText("主催", { exact: true })).toHaveCount(0);
	});
});
