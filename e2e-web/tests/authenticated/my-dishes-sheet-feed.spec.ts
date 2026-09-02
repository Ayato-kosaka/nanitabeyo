import type { Page, Route } from "@playwright/test";
import { PRERENDER_MISS_HYDRATION_NOISE } from "../../utils/consoleNoise";
import { test, expect } from "../../fixtures/test";
import { MyDishesPage } from "../../pages/MyDishesPage";
import { loadTestUserCredentials } from "../../utils/testUserSession";

/**
 * 🍽 #1397 my-dishes の «Map のピン → 料理メディア Sheet → 全画面 Feed» と
 * contextual filter chips の動作証跡（web / ログイン済み）。
 *
 * ## この spec が固定する完了条件（#1397）
 *
 * 1. **Map のピンをタップすると Sheet が開き、行タップで全画面 Feed が開く**
 *    （Map 経路 = ピン→Sheet→Feed。リーダー判断 Q1 で「ピン→Feed 直行」から読み替え済み）
 * 2. **Feed を閉じると元の画面へ戻り、Sheet が開きっぱなしにならない**（#644 の再発防止）
 * 3. **chips で絞ると list / Map / Calendar の 3 ビューすべてに反映される**
 *
 * ## ⚠️ Sheet の操作にホイールを使わない
 *
 * `page.mouse.wheel` は TrueSheet のジェスチャを 1 つも動かさない。ホイールで操作したつもりの
 * テストは「通ったように見えて何も検証していない」ものになるので、この spec は
 * `test.use({ hasTouch: true })` を宣言し、Sheet と Feed の操作を **`Locator.tap()`
 * （= `page.touchscreen` 経由の実タッチ）** に統一している。**このファイルに `mouse.wheel` は
 * 1 つも無い。**
 *
 * ## 実データではなくモックを使う理由（`my-dishes-calendar.spec.ts` と同じ）
 *
 * dev DB のテストユーザーの記録は件数も店舗も日付も変動するので、「ピンが 1 つある」
 * 「その店に 2 件の記録がある」「片方だけが chip の対象カテゴリ」といった前提を実データでは
 * 固定できない。ここで検証したいのは **導線と状態の伝播**であって API の中身ではないため、
 * `v1/users/me/dishes` / `.../map-pins` / `v1/dish-media` の 3 本を決定論的な値へ差し替える。
 * （API 自体の疎通は api 側のテストと tests/my-dishes/ の他 spec が受け持つ）
 *
 * ⚠️ `route.fulfill()` の封筒は **`{ success, data }` の 2 段**である。`useAPICall` は
 * `json.data` **だけ**を返し（`app-expo/hooks/useAPICall.ts`）、その中身が
 * `{ data, nextCursor, meta }`（`PaginatedResponse`）なので、
 * `{ success: true, data: { data: [...], nextCursor: null, meta: {...} } }` と 2 段で包むこと。
 * 1 段で返すと `response.data` が `undefined` になり、**画面は 0 件表示のまま静かに緑になる**。
 *
 * ## Tier
 * Tier 2（無タグ）。`desktop-chrome-authenticated` のみ。3 本とも取得をモックで止めるので
 * dev DB へは読み書きとも一切行かない（= `@mutation` ではない）。
 */
const credentials = loadTestUserCredentials();

test.skip(() => credentials === null, "TEST_USER_EMAIL / TEST_USER_PASSWORD(e2e-web/.env)が未設定のためスキップ");

// TrueSheet はタッチのジェスチャで動く。Desktop Chrome は既定で hasTouch: false なので、
// ここで明示的にタッチを有効化しないと `Locator.tap()` が使えない
test.use({ hasTouch: true });

const RESTAURANT_ID = "11111111-1111-1111-1111-00000000e2e5";
const RAMEN = { categoryId: "ramen", dishId: "dish-ramen", mediaId: "media-ramen", name: "味玉つけ麺" };
const CURRY = { categoryId: "curry", dishId: "dish-curry", mediaId: "media-curry", name: "スパイスカレー" };

/**
 * 「今月の 1 日 03:00Z」を返す。
 *
 * ⚠️ 固定日付を書くと、実行日によって Calendar に出る月グリッドの数が変わる。今月に寄せることで
 * いつ回しても «今月のグリッドに記録がある日が 1 つ以上ある» 形になる。03:00Z なのは
 * playwright.config.ts が固定している `Asia/Tokyo`（UTC+9）で見ても同じ 1 日（12:00）に落ち、
 * 月境界をまたがないため（`my-dishes-calendar.spec.ts` と同じ考え方）。
 */
function thisMonthIso(): string {
	const now = new Date();
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 3, 0, 0)).toISOString();
}

const OCCURRED_AT = thisMonthIso();

const restaurant = {
	id: RESTAURANT_ID,
	name: "E2E 食堂",
	// ピンを描く座標（東京駅付近）。1 店舗なので Map は初回取得後にここへ寄る
	latitude: 35.681236,
	longitude: 139.767125,
	image_url: "https://example.invalid/restaurant.jpg",
};

/** Sheet / リストが読むフィールドだけを持つ最小の `MyDishItem` */
function buildRow(dish: typeof RAMEN) {
	return {
		key: `review:${dish.dishId}`,
		status: "eaten",
		occurredAt: OCCURRED_AT,
		savedAt: null,
		eatenAt: OCCURRED_AT,
		restaurant,
		dish: {
			id: dish.dishId,
			restaurant_id: RESTAURANT_ID,
			category_id: dish.categoryId,
			name: dish.name,
			/*
			#1785 【契約】一覧・chip・Feed が出す «料理の表示名» は **`dish.name` ではなく
			`categoryLabels`** から来る（#1629 のオーナー確定。規則は
			app-expo/features/myDishes/dishCategoryLabel.ts）。
			ここが無いと `resolveDishCategoryLabel` が null を返し、画面には
			料理名の代わりに «写真なし» が出る。**モックに name しか無いと、
			アプリは正しいのにテストだけが落ちる。**
			*/
			categoryLabels: { ja: dish.name, en: dish.name },
			reviewCount: 1,
			averageRating: 4,
			categoryImageUrl: "https://example.invalid/category.jpg",
		},
		dishMedia: {
			id: dish.mediaId,
			dish_id: dish.dishId,
			media_type: "image",
			media_processing_status: "completed",
			mediaUrl: "https://example.invalid/media.jpg",
			thumbnailImageUrl: "https://example.invalid/thumb.jpg",
			isMine: true,
			isSaved: false,
			isLiked: false,
			likeCount: 0,
		},
		myReview: null,
		distanceMeters: null,
	};
}

/** Feed が読む `DishMediaEntry`（`GET /v1/dish-media?ids=` の戻り） */
function buildEntry(dish: typeof RAMEN) {
	const row = buildRow(dish);
	return {
		restaurant,
		dish: row.dish,
		dish_media: { ...row.dishMedia, render_type: "stored" },
		dish_reviews: [],
	};
}

/** `MyDishPin`。ピンは店舗単位で 1 つ（#1375 §3） */
const pin = {
	restaurant,
	counts: { want: 0, eaten: 2 },
	latestOccurredAt: OCCURRED_AT,
	representativeThumbnailUrl: "https://example.invalid/thumb.jpg",
};

/** 記録した 3 本のリクエスト（chip の反映を «クエリ» の側から確かめるのに使う） */
type RecordedRequest = { path: string; params: URLSearchParams };

/**
 * `v1/users/me/dishes` / `.../map-pins` / `v1/dish-media` を決定論的な値へ差し替える。
 *
 * **`categoryIds` が付いているかどうかで返す件数を変える**のがこの mock の肝である。
 * chip を押した結果は「クエリに `categoryIds` が乗ったか」だけでなく、
 * **3 ビューの描画が実際に減ったか**でも確かめられるようにする。
 *
 * @returns これまでに飛んだリクエストの記録（新しい順ではなく到着順）
 */
async function mockMyDishes(page: Page): Promise<RecordedRequest[]> {
	const recorded: RecordedRequest[] = [];

	/**
	 * CORS 込みで JSON を返す。
	 *
	 * API はビルド時に焼き込まれた Cloud Run の別オリジンなので、`Authorization` 付きの GET は
	 * プリフライト（OPTIONS）を伴う。ルートは OPTIONS も掴んでしまうため、ここで明示的に
	 * 204 を返さないと **プリフライトだけが失敗して本体が飛ばない**。
	 */
	const fulfillJson = async (route: Route, payload: unknown): Promise<void> => {
		const origin = (await route.request().headerValue("origin")) ?? "*";
		const cors = {
			"access-control-allow-origin": origin,
			"access-control-allow-credentials": "true",
			"access-control-allow-headers": "authorization,content-type,x-client-info,apikey",
			"access-control-allow-methods": "GET,POST,OPTIONS",
		};
		if (route.request().method() === "OPTIONS") {
			await route.fulfill({ status: 204, headers: cors, body: "" });
			return;
		}
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			headers: cors,
			// ⚠️ 封筒は 2 段（BaseResponse<PaginatedResponse<...>>）。冒頭コメント参照
			body: JSON.stringify({ success: true, data: payload }),
		});
	};

	const record = (route: Route, path: string): URLSearchParams => {
		const params = new URL(route.request().url()).searchParams;
		recorded.push({ path, params });
		return params;
	};

	// ── Map のピン ────────────────────────────────────────────────
	await page.route(
		(url: URL) => url.pathname.endsWith("/v1/users/me/dishes/map-pins"),
		async (route: Route) => {
			record(route, "map-pins");
			await fulfillJson(route, { data: [pin], truncated: false });
		},
	);

	// ── 一覧 / Calendar / Sheet / Feed の行（同じ endpoint。`restaurantId` の有無で用途が変わる） ──
	await page.route(
		(url: URL) => url.pathname.endsWith("/v1/users/me/dishes"),
		async (route: Route) => {
			const params = record(route, "dishes");
			// chip で絞られたら、その 1 カテゴリだけを返す（= 棚が実際に削れる）
			const categoryIds = params.get("categoryIds");
			const dishes =
				categoryIds === null ? [RAMEN, CURRY] : [RAMEN, CURRY].filter((d) => categoryIds.includes(d.categoryId));
			await fulfillJson(route, {
				data: dishes.map(buildRow),
				nextCursor: null,
				meta: { oldestOccurredAt: null },
			});
		},
	);

	// ── Feed のメディア本体 ───────────────────────────────────────
	await page.route(
		(url: URL) => url.pathname.endsWith("/v1/dish-media"),
		async (route: Route) => {
			const params = record(route, "dish-media");
			const ids = (params.get("ids") ?? "").split(",").filter(Boolean);
			const items = [RAMEN, CURRY].filter((d) => ids.includes(d.mediaId)).map(buildEntry);
			await fulfillJson(route, { items, notFound: [] });
		},
	);

	/*
	#1629 ── 表示ログ（インプレッション）──────────────────────────────
	Feed は表示されたメディアごとに `POST /v1/dish-media/<id>/impression` を投げる。
	ここのメディア id は spec が組んだ架空の値（`media-ramen` 等）なので、実 API は
	**400 を返す**。ブラウザはそれを console error として出し、REL-08 が spec を落とす
	（実測: `... status of 400 () [https://api-development.../v1/dish-media/media-ramen/impression]`）。
	記録の成否はこの spec の関心ではないので、204 で受け取って握る。
	*/
	await page.route(
		(url: URL) => /\/v1\/dish-media\/[^/]+\/impression$/.test(url.pathname),
		async (route: Route) => {
			const origin = (await route.request().headerValue("origin")) ?? "*";
			await route.fulfill({
				status: 204,
				headers: {
					"access-control-allow-origin": origin,
					"access-control-allow-credentials": "true",
					"access-control-allow-headers": "authorization,content-type,x-client-info,apikey",
					"access-control-allow-methods": "GET,POST,OPTIONS",
				},
				body: "",
			});
		},
	);

	return recorded;
}

/** 直近の `path` のリクエストのクエリを返す（無ければ null） */
function lastRequest(recorded: RecordedRequest[], path: string): URLSearchParams | null {
	const hit = recorded.filter((r) => r.path === path);
	return hit.length > 0 ? hit[hit.length - 1].params : null;
}

test.describe("#1375 Map のピン → 全画面 Feed / 下部の常設シート（web / ログイン済み）", () => {
	test.use({ allowedConsoleErrors: PRERENDER_MISS_HYDRATION_NOISE });

	// ─ テストケース: ピン → Sheet → Feed の Map 経路 ─
	// 手順:
	//   1. 3 本の API を決定論的な値へ差し替える
	//   2. `?view=map` で着地する（**既定ビューは list** なので付け忘れないこと）
	//   3. 下部の常設シートが、ピンを押さなくても出ていることを検証
	//   4. ピンをタップ（実タッチ）→ **その場で Sheet を開かず** 全画面 Feed へ遷移することを検証
	//   5. Feed を閉じる → 元の Map へ戻る
	//
	// #1375 実機確認でここが変わった。以前はピンタップで料理メディア Sheet を開いていたが、
	// Map の上に別の一覧が重なる形だった。Feed へ行けば «縦 = その店舗の記録» になり、
	// 閉じれば Map がそのまま残る。下部のシートは «常設の帯» として役割を変えた。
	test("下部シートは常設で、ピンタップは Feed へ遷移する", async ({ appPage }) => {
		const recorded = await mockMyDishes(appPage);
		const myDishes = new MyDishesPage(appPage);

		await myDishes.gotoView("map");
		await expect(myDishes.mapView).toBeVisible();

		// ① ピンを押さなくても下部シートは出ている（＝常設）
		await myDishes.expectMapSheetVisible();

		// ② ピン → 全画面 Feed（restaurant スコープ）
		await myDishes.tapFirstPin();
		await myDishes.expectFeedOpened();
		await expect(appPage).toHaveURL(/scope=restaurant/);
		// Feed は «その店舗だけ» を引き直す派生クエリを使う（共有フィルタには入れない。§7-1）
		expect(lastRequest(recorded, "dishes")?.get("restaurantId")).toBe(RESTAURANT_ID);
		// ⚠️ `my-dishes-feed-screen` は «読み込み中»・«0 件»・«失敗» でも描かれる器なので、それだけでは
		// 「Feed が開いた」の証跡にならない。chips のカテゴリラベルは «いま表示しているエントリ» の
		// `dish.name` から作られる（`MyDishesFeedChips`）ので、これが出ていることで
		// **その店舗の料理が実際に表示されている**ことまで確かめられる（R1）
		await expect(myDishes.chipWithText(RAMEN.name)).toBeVisible();

		// ③ 閉じる → 元の画面へ戻る
		await myDishes.feedCloseButton.tap();
		await expect(myDishes.feedScreen).toBeHidden();
		await expect(appPage).toHaveURL(/\/my-dishes(\?|$)/);
	});

	// ─ テストケース: 下部シートのタイルからも Feed に入れる ─
	// 手順:
	//   1. `?view=map` で着地する
	//   2. 下部シートの先頭タイルをタップする
	//   3. Feed が開くことを検証（ピン以外の経路でも Feed へ行けること）
	test("下部シートのタイルからも Feed が開く", async ({ appPage }) => {
		await mockMyDishes(appPage);
		const myDishes = new MyDishesPage(appPage);

		await myDishes.gotoView("map");
		await myDishes.expectMapSheetVisible();

		await myDishes.mapSheetTiles.first().tap();
		await myDishes.expectFeedOpened();
		// 器が出たことではなく、その料理が実際に表示されていることまで見る（1 本目と同じ理由）
		await expect(myDishes.chipWithText(RAMEN.name)).toBeVisible();
	});
});

test.describe("#1397 (PR5/5) contextual filter chips", () => {
	test.use({ allowedConsoleErrors: PRERENDER_MISS_HYDRATION_NOISE });

	// ─ テストケース: chip で絞ると 3 ビューすべてに反映される ─
	// 手順:
	//   1. 3 本の API を差し替える（`categoryIds` が付いたら 1 件だけ返す mock）
	//   2. Feed へ直接着地する（URL は restaurantId + itemKey + dishMediaId だけ。§9-2）
	//   3. chips が出ていること、**並び替えの chip が無いこと**を検証
	//   4. 「〈カレー〉で絞る」chip をタップ（実タッチ）
	//   5. Feed を閉じて my-dishes へ戻り、list / Calendar の棚が 1 件へ削れていることを検証
	//   6. Map は取得クエリに `categoryIds` が乗っていることで検証する
	test("chip を押すと list / Map / Calendar の 3 ビューすべてが同じ絞り込みになる", async ({ appPage }) => {
		const recorded = await mockMyDishes(appPage);
		const myDishes = new MyDishesPage(appPage);

		// URL に ids を積まない設計（§9-2）なので、直リンクでもこの 3 つだけで成立する
		await appPage.goto(
			`/ja-JP/my-dishes/feed?restaurantId=${RESTAURANT_ID}&itemKey=review:${CURRY.dishId}&dishMediaId=${CURRY.mediaId}`,
		);
		await expect(myDishes.feedScreen).toBeVisible();

		// ① chips は «いま見ている料理» のカテゴリで出る
		const categoryChip = myDishes.chipWithText(CURRY.name);
		await expect(categoryChip).toBeVisible();
		// リーダー判断 Q3: 並び替えの chip は作らない。出るのは «絞る» だけ
		const labels = await myDishes.feedChips.allInnerTexts();
		expect(labels.some((label) => label.includes("並べ"))).toBe(false);

		// ② chip をタップ（共有フィルタ store を書く唯一の操作）
		await categoryChip.tap();

		// ③ Feed を閉じて 3 ビューへ戻る。直リンク着地なので router.replace で my-dishes へ落ちる
		await myDishes.feedCloseButton.tap();
		await expect(appPage).toHaveURL(/\/my-dishes(\?|$)/);

		// ④ list: 2 件あった棚が 1 件（カレーだけ）に削れている
		await myDishes.selectView("list");
		await expect(myDishes.listItems).toHaveCount(1);
		await expect(myDishes.listView).toContainText(CURRY.name);
		await expect(myDishes.listView).not.toContainText(RAMEN.name);
		expect(lastRequest(recorded, "dishes")?.get("categoryIds")).toContain(CURRY.categoryId);

		// ⑤ Calendar: 同じ絞り込みで «記録がある日» が 1 つだけになる
		await myDishes.selectView("calendar");
		await expect(myDishes.calendarDays).toHaveCount(1);

		// ⑥ Map: ピンの取得クエリにも同じ `categoryIds` が乗る
		await myDishes.selectView("map");
		await expect(async () => {
			expect(lastRequest(recorded, "map-pins")?.get("categoryIds")).toContain(CURRY.categoryId);
		}).toPass();
	});

	// ─ テストケース: chip を押しても足元の Feed は崩れない（§10-3） ─
	// 手順:
	//   1. Feed へ直接着地する
	//   2. chip をタップして共有フィルタを変える
	//   3. Feed が閉じず、そのまま見続けられることを検証
	test("chip を押しても Feed は閉じない（開いた時点の並びのまま見続けられる）", async ({ appPage }) => {
		await mockMyDishes(appPage);
		const myDishes = new MyDishesPage(appPage);

		await appPage.goto(
			`/ja-JP/my-dishes/feed?restaurantId=${RESTAURANT_ID}&itemKey=review:${CURRY.dishId}&dishMediaId=${CURRY.mediaId}`,
		);
		await expect(myDishes.feedScreen).toBeVisible();

		await myDishes.chipWithText(CURRY.name).tap();

		await expect(myDishes.feedScreen).toBeVisible();
		await expect(appPage).toHaveURL(/\/my-dishes\/feed/);
	});
});
