import { test, expect } from "../../fixtures/test";
import { PRERENDER_MISS_HYDRATION_NOISE } from "../../utils/consoleNoise";
import type { Page, Response } from "@playwright/test";
import type { DishMediaEntry } from "@shared/api/v1/res";
import { SearchPage } from "../../pages/SearchPage";
import { DishCategoriesPage } from "../../pages/DishCategoriesPage";
import { ResultPage } from "../../pages/ResultPage";
import { RestaurantDetailPage } from "../../pages/RestaurantDetailPage";

/**
 * 🚫 実体未着（media_processing_status !== 'completed'）の料理メディアが一覧に出ないこと（#1257）
 *
 * 実行プロジェクト: desktop-chrome（匿名 storageState）
 *
 * ## 何を守るテストか
 * #1257 は「投稿されたが GCS に原本が届いていない dish_media が、検索候補として
 * 選ばれてしまう」不具合。動画の場合 `mediaUrl` が null で返るため、フィードには
 * **再生できないカード** が並ぶ。修正は API 側の 2 つの候補集合クエリで
 * `media_processing_status = 'completed'` に絞ったこと:
 *
 * - `findDishMediaIds()`        … 検索フィード（`GET /v1/dish-media/search`）
 * - `findDishMediaByRestaurant()` … 店舗フィード（`GET /v1/restaurants/:id/dish-media`）
 *
 * ## なぜ API をモックしないのか
 * 検証したいのは **サーバ側の絞り込み** そのものである。`page.route()` で応答を差し替えると
 * 「テストが用意した completed だけの配列」を確かめるだけの循環した検証になり、
 * SQL から述語を消しても緑のままになる。
 * そこでこの spec は **実 API（api-development）の応答をそのまま観測**し、
 * 一覧 API が返した全件が completed であることをアサートする。
 * `restaurant-routes.spec.ts` がモックを使うのは検証対象がルーティングだからで、方針が違う。
 *
 * ⚠️ **dev DB に未着行が 1 件も無ければ、このテストは «素通り» する。**
 * それでも回帰ロックとしては機能する（述語を消した状態で未着行があれば赤になる）が、
 * 「未着行を必ず 1 件混ぜた状態」を作れるのは実 DB を握れる API の統合テストだけである。
 * 決定論的な検証は `api/test/functional/v1/dish-media/*.e2e-spec.ts` が持つ。
 * dev DB へ書き込まないので @mutation ではない。
 */

/** API が返した料理メディアが「実体到達済み」であることを検証する */
function expectAllArrived(entries: DishMediaEntry[], source: string): void {
	for (const entry of entries) {
		const media = entry.dish_media;
		expect(
			media.media_processing_status,
			`${source}: dish_media ${media.id} が media_processing_status=${media.media_processing_status} のまま一覧に混ざっている（#1257）`,
		).toBe("completed");

		// #1257 の «見た目の症状» 側。動画は completed 以外だと mediaUrl が null で返るため、
		// ステータスを見るアサーションが将来ゆるんでも、ここで再生不能カードを止められる
		expect(media.mediaUrl, `${source}: dish_media ${media.id} の mediaUrl が空`).toBeTruthy();
	}
}

/**
 * #530 未着カードにだけ重なるオーバーレイの文言（`app-expo/locales/ja-JP.json` の `DishMediaContent`）。
 * `DishMediaContent.tsx` が media_processing_status を見て描き分けており、
 * 未着の行が一覧へ紛れ込んだときにだけ画面に出る。e2e-mobile 側はこちらだけで検証している
 *（Detox には応答 JSON を覗く手段が無いため）。
 */
const PROCESSING_TEXT = "メディアを処理中...";
const UNAVAILABLE_TEXT = "このメディアは現在ご利用いただけません。";

/** 未着カードのオーバーレイが画面に出ていないことを検証する（e2e-mobile と同じ観測点） */
async function expectNoUnarrivedOverlay(page: Page): Promise<void> {
	await expect(page.getByText(PROCESSING_TEXT)).toHaveCount(0);
	await expect(page.getByText(UNAVAILABLE_TEXT)).toHaveCount(0);
}

/** `{ success, data }` の封筒を剥がして DishMediaEntry[] を取り出す（形が違えば null） */
async function readEntries(response: Response, pick: (data: any) => unknown): Promise<DishMediaEntry[] | null> {
	if (!response.ok()) return null;
	const body = await response.json().catch(() => null);
	const entries = body?.success ? pick(body.data) : null;
	return Array.isArray(entries) ? (entries as DishMediaEntry[]) : null;
}

/**
 * 指定パターンの API 応答を集め続けるコレクタを仕掛ける。
 *
 * `page.on("response")` はハンドラ登録後の応答しか拾えないので、画面遷移より前に呼ぶこと。
 */
function collectDishMediaResponses(
	page: Page,
	pattern: RegExp,
	pick: (data: any) => unknown,
): { entries: DishMediaEntry[]; responseCount: () => number } {
	const entries: DishMediaEntry[] = [];
	let responseCount = 0;

	page.on("response", (response: Response) => {
		if (!pattern.test(response.url())) return;
		responseCount += 1;
		void readEntries(response, pick).then((collected) => {
			if (collected) entries.push(...collected);
		});
	});

	return { entries, responseCount: () => responseCount };
}

test.describe("実体未着の料理メディアは一覧に出ない（#1257）", () => {
	test.use({ allowedConsoleErrors: PRERENDER_MISS_HYDRATION_NOISE });

	// 実 API + AI によるお題生成を経由するため、既定の 30 秒では足りない
	// （tests/search/dish-media-accessibility.spec.ts と同じ理由）
	test.setTimeout(90_000);
	// dev 環境のデータ都合で結果フィードの取得が失敗することが実測されている既知のフレーク。
	// 再実行すれば別の料理が選ばれて成功することが多い
	test.describe.configure({ retries: 2 });

	// ─ テストケース: 検索フィードの応答が completed だけで構成される ─
	// 手順:
	//   1. `GET /v1/dish-media/search` の応答コレクタを仕掛ける
	//   2. 検索 → お題選択 → 結果フィードまで実際に操作する
	//   3. 返ってきた全 dish_media が completed かつ mediaUrl を持つことを検証する
	test("検索フィードの API 応答に未着メディアが含まれない", async ({ appPage }) => {
		const searchPage = new SearchPage(appPage);
		const dishCategoriesPage = new DishCategoriesPage(appPage);
		const resultPage = new ResultPage(appPage);

		// SearchDishMediaResponse は DishMediaEntry[] そのもの（封筒の data が配列）
		const search = collectDishMediaResponses(appPage, /\/v1\/dish-media\/search(\?.*)?$/, (data) => data);

		await searchPage.typeLocation("渋谷");
		await searchPage.selectLocationSuggestion(0);
		await searchPage.submitButton.click();
		await dishCategoriesPage.expectLoaded();
		await dishCategoriesPage.chooseFirstDishCategory();
		await resultPage.expectLoaded();

		// 応答の JSON 読み取りは非同期なので、フィードが描かれたあとに落ち着くのを待つ
		await expect
			.poll(() => search.responseCount(), { message: "検索 API の応答を 1 件も観測できなかった" })
			.toBeGreaterThan(0);
		await appPage.waitForTimeout(1_000);

		expectAllArrived(search.entries, "GET /v1/dish-media/search");
		await expectNoUnarrivedOverlay(appPage);
	});

	// ─ テストケース: 店舗フィードの応答が completed だけで構成される ─
	// #1257 検索側だけ直すと、未着メディアが «店舗詳細 → フィード» 経由でだけ露出し続ける。
	// 店舗 ID は実データが要るので、検索フィードの応答から実在する店舗を 1 件借りる
	// （固定 ID を埋め込むと dev DB の入れ替えで腐り、`POST /v1/restaurants` で作ると @mutation になる）。
	// 手順:
	//   1. 検索フローを通し、応答から実在する restaurantId を取り出す
	//   2. `/ja-JP/review/restaurant/<id>/feed` へ直接遷移する
	//   3. `GET /v1/restaurants/:id/dish-media` の応答が completed だけであることを検証する
	test("店舗フィードの API 応答に未着メディアが含まれない", async ({ appPage }) => {
		const searchPage = new SearchPage(appPage);
		const dishCategoriesPage = new DishCategoriesPage(appPage);
		const resultPage = new ResultPage(appPage);
		const detailPage = new RestaurantDetailPage(appPage);

		const search = collectDishMediaResponses(appPage, /\/v1\/dish-media\/search(\?.*)?$/, (data) => data);

		await searchPage.typeLocation("渋谷");
		await searchPage.selectLocationSuggestion(0);
		await searchPage.submitButton.click();
		await dishCategoriesPage.expectLoaded();
		await dishCategoriesPage.chooseFirstDishCategory();
		await resultPage.expectLoaded();

		await expect
			.poll(() => search.entries.length, { message: "検索 API から料理メディアを 1 件も取得できなかった" })
			.toBeGreaterThan(0);

		const restaurantId = search.entries[0].restaurant.id;

		// QueryRestaurantDishMediaResponse は `{ data, nextCursor }`（封筒の中にもう一段 data がある）
		const feed = collectDishMediaResponses(
			appPage,
			/\/v1\/restaurants\/[^/?]+\/dish-media(\?.*)?$/,
			(data) => data?.data,
		);

		await detailPage.gotoSub("feed", restaurantId);
		await detailPage.expectFeedOpened();

		await expect
			.poll(() => feed.responseCount(), { message: "店舗フィード API の応答を 1 件も観測できなかった" })
			.toBeGreaterThan(0);
		await appPage.waitForTimeout(1_000);

		expectAllArrived(feed.entries, "GET /v1/restaurants/:id/dish-media");
		await expectNoUnarrivedOverlay(appPage);
	});
});
