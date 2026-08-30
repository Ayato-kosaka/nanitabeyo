import type { Locator, Page, Route } from "@playwright/test";
import { test, expect } from "../../fixtures/test";
import { loadTestUserCredentials } from "../../utils/testUserSession";

/**
 * 🗓 my-dishes Calendar ビュー: web で「上へスクロールして過去へ遡れる」ことの動作証跡（#1446 M-3）
 *
 * ## なぜこの spec が要るのか
 *
 * PR #1446 のレビューで、Calendar の実装根拠が「`node_modules` の実コードを読んだ結果」に
 * 留まっており、**web で実際に上へ遡れる動作証跡が無い**ことが Major 指摘になった。
 * ここが本ビューの存在理由そのもの（#1396 の完了条件に「web ビルドでも動作すること」がある）なので、
 * 実ブラウザ（Chromium / react-native-web ビルド）で次の 3 点を確かめる。
 *
 * 1. `?view=calendar` で直接着地して月グリッドが描かれる
 * 2. **マウスホイールを「上」へ回すと、より古い月のグリッドが増える**
 *    （= `inverted` FlatList の `onEndReached` が視覚的な上端で発火し、次ページが読まれる）
 * 3. 終端まで遡ると `reachedOldest` が出て、それ以上取得しない
 *
 * ⚠️ 2 は react-native-web の `VirtualizedList` に入っている
 * `REACT-NATIVE-WEB patch ... Support inverted wheel scroller.` を通る経路である。
 * ソースを読むだけでは「本当にホイール方向が反転せずに遡れるか」は確定できない、というのが
 * レビュー指摘の中身だったので、ここは **実際にホイールイベントを流して**確認する。
 *
 * ## 実データではなくモックを使う理由
 *
 * dev DB のテストユーザーの記録件数・日付は変動するので、「N か月ぶんのグリッドが増える」を
 * 実データで安定して観測できない。ここで検証したいのは **描画とスクロールの挙動**であって
 * API の中身ではないため、`v1/users/me/dishes` を決定論的な 2 ページに差し替える。
 * （API 自体の疎通は tests/my-dishes/ の他 spec と api 側のテストが受け持つ）
 *
 * ⚠️ `route.fulfill()` を使うときは **`BaseResponse` の封筒 `{ success, data }` を外さないこと**。
 * `useAPICall` は `json.data` だけを取り出すので、封筒を忘れると画面がエラー表示になる
 * （utils/dishCategoryGroupVote.ts の mockVoteDetail に同じ注意書きがある）。
 * このエンドポイントは中身が `PaginatedResponse` なので封筒は **2 段**になる
 * （`{ success, data: { data, nextCursor, meta } }`）。詳細は `mockMyDishesPages` のコメント。
 *
 * ## Tier
 * Tier 2（無タグ）。`desktop-chrome-authenticated` のみで実行し、dev DB へは一切書き込まない
 * （取得もモックで止めるので `@mutation` ではない）。
 */
const credentials = loadTestUserCredentials();

test.skip(() => credentials === null, "TEST_USER_EMAIL / TEST_USER_PASSWORD(e2e-web/.env)が未設定のためスキップ");

const pad2 = (value: number): string => (value < 10 ? `0${value}` : String(value));

/**
 * 「今月から n か月前」の `YYYY-MM` と、その月の 15 日を指す ISO8601 を返す。
 *
 * ⚠️ 日付を固定値で書くと、実行日によって「今月からその月まで何個のグリッドが出るか」が変わる。
 * 相対で作ることで、いつ回しても「新しい月から古い月へ連続したグリッドが並ぶ」形になる。
 * 時刻を 03:00Z にしてあるのは、playwright.config.ts が固定している `Asia/Tokyo`（UTC+9）で
 * 見ても同じ 15 日（12:00）に落ち、月境界をまたがないようにするため。
 */
function monthsAgo(n: number): { ym: string; iso: string } {
	const now = new Date();
	const year = now.getUTCFullYear();
	const monthIndex = now.getUTCMonth() - n;
	const anchor = new Date(Date.UTC(year, monthIndex, 15, 3, 0, 0));
	return {
		ym: `${anchor.getUTCFullYear()}-${pad2(anchor.getUTCMonth() + 1)}`,
		iso: anchor.toISOString(),
	};
}

/** Calendar が読むフィールドだけを持つ最小の `MyDishItem` */
function buildItem(key: string, occurredAt: string) {
	return {
		key,
		status: "eaten",
		occurredAt,
		savedAt: null,
		eatenAt: occurredAt,
		restaurant: { id: "restaurant-e2e", name: "E2E 食堂", image_url: null },
		dish: {
			id: `dish-${key}`,
			name: "E2E ラーメン",
			reviewCount: 1,
			averageRating: 4,
			// 写真なしの記録でも灰色プレースホルダーにしない契約（#1375 追補2 決定3）。
			// 実在しないホストなので画像自体は読めないが、描画経路の確認には十分
			categoryImageUrl: "https://example.invalid/category.jpg",
		},
		dishMedia: null,
		myReview: null,
		distanceMeters: null,
	};
}

const RECENT = monthsAgo(1);
const MIDDLE = monthsAgo(4);
const OLDEST = monthsAgo(9);

/**
 * `GET /v1/users/me/dishes` を決定論的な 2 ページに差し替える。
 *
 * - 1 ページ目（cursor 無し）: 1 か月前 + 4 か月前 の 2 件。`nextCursor` あり
 * - 2 ページ目（cursor あり）: 9 か月前 の 1 件。`nextCursor: null` = 終端
 *
 * @returns 何ページ取得されたかを返す関数（自動連投していないことの確認に使う）
 */
async function mockMyDishesPages(page: Page): Promise<() => number> {
	let requestCount = 0;

	await page.route(
		(url: URL) => url.pathname.endsWith("/v1/users/me/dishes"),
		async (route: Route) => {
			// map-pins など別エンドポイントは掴まない（pathname の完全一致で判定している）
			requestCount += 1;
			const hasCursor = new URL(route.request().url()).searchParams.has("cursor");

			// ⚠️ 封筒は **2 段**（`BaseResponse<PaginatedResponse<MyDishItem>>`）。
			// `useAPICall` が返すのは `json.data` **だけ**（hooks/useAPICall.ts の「data のみを返す」）で、
			// その中身を `useMyDishesQuery` が `response.data` / `response.nextCursor` /
			// `response.meta.oldestOccurredAt` と読む。1 段で包むと `response.data` が
			// `undefined` になり、**行が 0 件のまま静かに緑になる**（実際にこの spec がそうなっていた）
			const body = hasCursor
				? {
						success: true,
						data: {
							data: [buildItem("review:oldest", OLDEST.iso)],
							nextCursor: null,
							meta: { oldestOccurredAt: null },
						},
					}
				: {
						success: true,
						data: {
							data: [buildItem("review:recent", RECENT.iso), buildItem("review:middle", MIDDLE.iso)],
							nextCursor: "cursor-page-2",
							meta: { oldestOccurredAt: null },
						},
					};

			await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
		},
	);

	return () => requestCount;
}

/**
 * リストの上（過去）方向へホイールを回し、`locator` が現れるまで待つ。
 *
 * `inverted` なので「視覚的に上へ遡る」= 負の `deltaY`。react-native-web は inverted リストの
 * ホイールを自前でパッチしているので、ここが素通しになると **方向が反転して遡れなくなる**。
 */
async function wheelUpUntilVisible(page: Page, locator: Locator): Promise<void> {
	const list = page.getByTestId("my-dishes-calendar-list");
	await list.hover();

	for (let i = 0; i < 40; i += 1) {
		if ((await locator.count()) > 0) return;
		await page.mouse.wheel(0, -500);
		await page.waitForTimeout(150);
	}
}

test.describe("my-dishes Calendar ビュー（web / ログイン済み）", () => {
	// ─ テストケース: ?view=calendar に着地して上方向へ遡れる ─
	// 手順:
	//   1. `v1/users/me/dishes` を決定論的な 2 ページへ差し替える
	//   2. `/ja-JP/my-dishes?view=calendar` へ直接着地する
	//   3. 直近の月グリッド（1 か月前）が描かれ、**記録がある日のセルが実際に出ている**ことを検証
	//   4. まだ 2 ページ目は読まれていない（9 か月前のグリッドが無い）ことを検証
	//   5. ホイールを「上」へ回して、1 ページ目の範囲（4 か月前）→ 2 ページ目（9 か月前）の順に
	//      グリッドが現れることを検証（★本命）
	//   6. 終端表示（reachedOldest）が出て、取得が 2 回で止まっていることを検証
	test("?view=calendar に着地し、上へスクロールすると過去の月が増える", async ({ appPage }) => {
		const requestCount = await mockMyDishesPages(appPage);

		await appPage.goto("/ja-JP/my-dishes?view=calendar");

		const list = appPage.getByTestId("my-dishes-calendar-list");
		await expect(list).toBeVisible();

		// ⚠️ **描かれた月グリッドの数と «月の配列» の数は一致しない。** `FlatList` は仮想化されており
		// （`initialNumToRender={2}` / `windowSize={5}`）、着地直後に DOM にあるのは下端＝最新の
		// 数か月ぶんだけである。1 ページ目に含まれる 4 か月前のグリッドも、遡って初めて生える。
		// ここで «着地直後に» 4 か月前を待つと、仮想化のせいで «実装は正しいのに» 落ちる。
		const recentMonth = appPage.getByTestId(`my-dishes-calendar-month-${RECENT.ym}`);
		await expect(recentMonth).toBeAttached();
		// 封筒が正しく解けていること（= 行が本当に届いていること）を «記録がある日» で確かめる。
		// 1 段の封筒に戻すとここは 0 件になり、0 件表示へ落ちてこのテストは落ちる。
		// ⚠️ 数える範囲を «その月のグリッド» に閉じること。ページ全体で数えると、仮想化が
		// 何か月ぶんを DOM に載せるかで期待値が変わってしまう
		await expect(recentMonth.getByTestId("my-dishes-calendar-day")).toHaveCount(1);

		// まだ読んでいない月は先に生やさない（#1396 §4-4）
		const oldestMonth = appPage.getByTestId(`my-dishes-calendar-month-${OLDEST.ym}`);
		await expect(oldestMonth).toHaveCount(0);
		expect(requestCount()).toBe(1);

		// ★ 本命 1: 上（過去）方向へスクロールすると、1 ページ目で読めている範囲の古い月が生える
		const middleMonth = appPage.getByTestId(`my-dishes-calendar-month-${MIDDLE.ym}`);
		await wheelUpUntilVisible(appPage, middleMonth);
		await expect(middleMonth).toBeAttached();

		// ★ 本命 2: さらに遡ると次ページが読まれ、1 ページ目には無かった月が足される
		await wheelUpUntilVisible(appPage, oldestMonth);
		await expect(oldestMonth).toBeAttached();

		// 終端まで来たので「これ以上さかのぼれません」が出る
		await expect(appPage.getByTestId("my-dishes-calendar-reached-oldest")).toBeAttached();

		// #1446 B-1 / M-1: 指を離したままの自動連投になっていないこと。
		// 2 ページで終端なので、取得はちょうど 2 回で止まる
		await appPage.waitForTimeout(1000);
		expect(requestCount()).toBe(2);
	});
});
