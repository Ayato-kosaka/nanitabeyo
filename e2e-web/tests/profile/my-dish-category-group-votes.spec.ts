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
 * web 側で担保するのは「画面が主催バッジを持たず、行のバッジが投票済み/未投票だけになった」こと。
 *
 * 投票結果画面への遷移確認は、既存の `utils/dishCategoryGroupVote.ts`（#1120 の spec 用に作られた
 * detail API のモック）をそのまま再利用する。`MOCK_SHARE_TOKEN` を一覧アイテムの shareToken に
 * 合わせれば、タップ後の遷移先（`[shareToken]` 結果画面）もモックだけで到達できる。
 */

/** GET /v1/users/me/dish-category-group-votes のパス（cursor 等のクエリを許容） */
const LIST_URL_PATTERN = /\/v1\/users\/me\/dish-category-group-votes(\?.*)?$/;

/**
 * `MeDishCategoryGroupVoteListItem` の表示日付を、画面側（VoteListItem）と同じ式で計算する。
 * 行に testID が無く `accessibilityLabel={formattedDate}` だけが観測点のため、
 * モックする `createdAt` からここで計算した文字列を `getByRole("link", { name })` に渡す。
 */
function formatItemDate(createdAt: string, locale = "ja-JP"): string {
	return new Date(createdAt).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });
}

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

function buildItem(overrides: Partial<MeDishCategoryGroupVoteListItem>): MeDishCategoryGroupVoteListItem {
	return {
		id: "e2e-1505-item",
		shareToken: "e2e-1505-share-token",
		hasVoted: false,
		candidateCount: 3,
		createdAt: "2026-08-10T00:00:00.000Z",
		updatedAt: "2026-08-10T00:00:00.000Z",
		...overrides,
	};
}

test.describe("グループ投票の履歴一覧 (#1505)", () => {
	// ─ テストケース: 一覧が表示される ─
	test("一覧が表示される", async ({ appPage }) => {
		const item = buildItem({ id: "e2e-1505-list", shareToken: "e2e-1505-share-list", candidateCount: 4 });
		await mockMeDishCategoryGroupVotes(appPage, [item]);

		const listPage = new MyDishCategoryGroupVotesPage(appPage);
		await listPage.goto();
		await listPage.expectLoaded();

		await expect(listPage.item(formatItemDate(item.createdAt))).toBeVisible();
	});

	// ─ テストケース: 0 件のときは空表示が出る ─
	test("0件のときは空状態が表示される", async ({ appPage }) => {
		await mockMeDishCategoryGroupVotes(appPage, []);

		const listPage = new MyDishCategoryGroupVotesPage(appPage);
		await listPage.goto();
		await listPage.expectLoaded();
		await listPage.expectEmpty();
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

		await listPage.openItem(formatItemDate(item.createdAt));

		await expect(appPage).toHaveURL(new RegExp(`/search/dish-category-group-votes/${MOCK_SHARE_TOKEN}`));
		await expect(appPage.getByTestId("dish-category-group-vote-copy-share-link")).toBeVisible();
	});

	// ─ テストケース: 主催バッジは無く、投票済み/未投票だけが行ごとに出る（#1505 仕様変更） ─
	// 一覧は主催した投票だけになったため「主催」バッジは撤去した。行に残るのは投票状態のバッジ 1 つ。
	// 各行にスコープしたロケータ（getByRole("link",{name}) から辿った子要素）で行ごとに検証する。
	test("主催バッジは出ず、投票済み/未投票だけが行ごとに出る", async ({ appPage }) => {
		const notVoted = buildItem({
			id: "e2e-1505-not-voted",
			shareToken: "e2e-1505-share-not-voted",
			hasVoted: false,
			candidateCount: 3,
			createdAt: "2026-08-10T00:00:00.000Z",
		});
		const voted = buildItem({
			id: "e2e-1505-voted",
			shareToken: "e2e-1505-share-voted",
			hasVoted: true,
			candidateCount: 5,
			createdAt: "2026-08-05T00:00:00.000Z",
		});
		await mockMeDishCategoryGroupVotes(appPage, [notVoted, voted]);

		const listPage = new MyDishCategoryGroupVotesPage(appPage);
		await listPage.goto();
		await listPage.expectLoaded();

		const notVotedRow = listPage.item(formatItemDate(notVoted.createdAt));
		const votedRow = listPage.item(formatItemDate(voted.createdAt));

		// 自分がまだ投票していない投票: 「未投票」だけ
		await expect(notVotedRow.getByText("未投票", { exact: true })).toBeVisible();
		await expect(notVotedRow.getByText("投票済み", { exact: true })).toHaveCount(0);

		// 自分も投票済みの投票: 「投票済み」だけ
		await expect(votedRow.getByText("投票済み", { exact: true })).toBeVisible();
		await expect(votedRow.getByText("未投票", { exact: true })).toHaveCount(0);

		// 「主催」バッジは画面のどこにも無い（全行が主催なので不要になった）
		await expect(appPage.getByText("主催", { exact: true })).toHaveCount(0);

		// 候補数は日付と同じ行に畳んで表示する（#1505 密度調整）
		await expect(notVotedRow.getByText("候補 3 件", { exact: true })).toBeVisible();
	});
});
